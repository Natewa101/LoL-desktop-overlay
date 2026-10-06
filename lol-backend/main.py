import sys
import io

# When frozen with PyInstaller --noconsole, there is no attached console, so
# sys.stdout / sys.stderr are None. Uvicorn's default logging config calls
# stream.isatty() during setup and crashes ("'NoneType' has no attribute
# 'isatty'"). Provide harmless in-memory streams as a fallback.
if getattr(sys, 'frozen', False):
    if sys.stdout is None:
        sys.stdout = io.StringIO()
    if sys.stderr is None:
        sys.stderr = io.StringIO()

import concurrent.futures
import logging
from contextlib import asynccontextmanager

import requests
import urllib3
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import config
from database_queries import (
    get_champion_id_by_name,
    get_matchup_analysis,
    recommend_champion,
    resource_path,
    translate_champion_ids,
)
from lcu_connector import get_lcu_credentials
from scraper import fetch_recent_matches

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger("lol_backend")

APP_VERSION = "1.0.0"
REQUIRED_ASSETS = ("league_database.db", "draft_model.pkl", "model_features.pkl")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Starting LoL Draft Assistant backend v%s", APP_VERSION)
    logger.info("Runtime: %s", "frozen executable" if getattr(sys, "frozen", False) else "python source")
    for asset in REQUIRED_ASSETS:
        if resource_path(asset).is_file():
            logger.info("Asset ready: %s", asset)
        else:
            logger.warning("Asset missing: %s (related endpoints will return errors)", asset)
    if not config.RIOT_API_KEY:
        logger.warning("RIOT_API_KEY not set; /api/live-history is disabled. Live overlay features are unaffected.")
    logger.info("CORS origins: %s", ", ".join(config.CORS_ORIGINS))
    yield
    logger.info("Backend shutting down")


app = FastAPI(title="LoL Draft Assistant API", version=APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {"status": "ok", "service": "lol-draft-assistant-backend", "version": APP_VERSION}


# Fetch the latest match for a Riot ID via the public Riot API (requires RIOT_API_KEY).
@app.get("/api/live-history")
def get_live_history(name: str, tag: str):
    result = fetch_recent_matches(name, tag)

    # If our scraper ran into an error, send it back to the frontend cleanly
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return result


# Query the database for matchup winrate and recommended items.
@app.get("/api/matchup-analysis")
def get_matchup_analysis_endpoint(my_champ: str, enemy_champ: str):
    """Get winrate and recommended items for a champion matchup."""

    # Try to get champion IDs from names
    my_champ_id = get_champion_id_by_name(my_champ)
    enemy_champ_id = get_champion_id_by_name(enemy_champ)

    # If names not found, try treating them as IDs directly
    if my_champ_id is None:
        try:
            my_champ_id = int(my_champ)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Champion '{my_champ}' not found")

    if enemy_champ_id is None:
        try:
            enemy_champ_id = int(enemy_champ)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Champion '{enemy_champ}' not found")

    # Get matchup analysis from database
    analysis = get_matchup_analysis(my_champ_id, enemy_champ_id)

    # Format response for frontend
    winrate = analysis["winrate_data"]["winrate"]
    total_games = analysis["winrate_data"]["total_games"]

    # Extract top recommended items
    recommended_items = []
    for item in analysis["recommended_items"]:
        recommended_items.append({
            "item_id": item["item_id"],
            "build_count": item["build_count"],
            "build_rate": item["build_rate"]
        })

    return {
        "status": "success",
        "my_champion": my_champ,
        "enemy_champion": enemy_champ,
        "my_champion_id": my_champ_id,
        "enemy_champion_id": enemy_champ_id,
        "predicted_winrate": winrate,
        "total_games": total_games,
        "recommended_items": recommended_items
    }


# Recommend a champion based on team composition.
@app.get("/api/team-recommendation")
def get_team_recommendation(enemy_team: str, ally_team: str = "", top_n: int = 5):
    """Get champion recommendations based on team composition using trained model."""

    # Parse comma-separated champion lists
    enemy_champions = [champ.strip() for champ in enemy_team.split(',') if champ.strip()]
    ally_champions = [champ.strip() for champ in ally_team.split(',') if champ.strip()]

    # Validate inputs
    if len(enemy_champions) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 enemy champions allowed")

    if len(ally_champions) > 4:
        raise HTTPException(status_code=400, detail="Maximum 4 ally champions allowed")

    if not enemy_champions:
        raise HTTPException(status_code=400, detail="At least 1 enemy champion required")

    # Get recommendation from trained model
    recommendation = recommend_champion(enemy_champions, ally_champions, top_n)

    if recommendation["status"] == "error":
        raise HTTPException(status_code=400, detail=recommendation["message"])

    return recommendation


# Read the live League client champ select state automatically.
@app.get("/api/live-client-draft")
def get_live_client_draft(top_n: int = 5):
    """Read the live client state from the running League client (LCU).

    The authoritative source for which stage of a game we are in is the LCU
    gameflow phase (`/lol-gameflow/v1/gameflow-phase`), which reports one of:
    "None", "Lobby", "Matchmaking", "ReadyCheck", "ChampSelect", "GameStart",
    "InProgress", "Reconnect", "WaitingForStats", "PreEndOfGame", "EndOfGame".

    Those phases collapse into four frontend statuses:
        - "OFFLINE": the League client is not running (no lockfile found).
        - "LOBBY":   client / lobby / queue / ready-check (pre-match overlay).
        - "ACTIVE":  champ select in progress; champions + recommendations.
                     (pre-match overlay)
        - "GAME":    loading screen + in game (post-match overlay).

    The raw phase string is also returned as `phase` for debugging/telemetry.
    """
    creds = get_lcu_credentials()

    # No lockfile -> client is closed.
    if creds is None:
        return {"status": "OFFLINE", "message": "League client not detected."}

    # Step 1: ask the client which gameflow phase it is in. This reliably
    # distinguishes the client/lobby from the loading screen and live game,
    # unlike the champ-select 404 which fires in the lobby too.
    phase_url = f"{creds['base_url']}/lol-gameflow/v1/gameflow-phase"
    try:
        phase_resp = requests.get(
            phase_url,
            headers=creds["headers"],
            verify=False,
            timeout=3,
        )
    except requests.exceptions.RequestException:
        return {"status": "OFFLINE", "message": "Could not reach League client."}

    # The endpoint returns a bare JSON string, e.g. "InProgress".
    phase = phase_resp.json() if phase_resp.status_code == 200 else "None"

    # Stages 3 & 4 (loading screen + in game) -> GAME (post-match overlay).
    IN_GAME_PHASES = {
        "GameStart",
        "InProgress",
        "Reconnect",
        "WaitingForStats",
        "PreEndOfGame",
        "EndOfGame",
    }
    if phase in IN_GAME_PHASES:
        return {"status": "GAME", "phase": phase, "message": "Game in progress."}

    # Stage 2 (champ select) -> ACTIVE draft with recommendations.
    if phase == "ChampSelect":
        session_url = f"{creds['base_url']}/lol-champ-select/v1/session"
        try:
            response = requests.get(
                session_url,
                headers=creds["headers"],
                verify=False,
                timeout=3,
            )
        except requests.exceptions.RequestException:
            return {
                "status": "LOBBY",
                "phase": phase,
                "message": "Could not read champ select session.",
            }

        if response.status_code == 200:
            session = response.json()

            # Extract numeric champion IDs for each team
            my_team_ids = [m.get("championId", 0) for m in session.get("myTeam", [])]
            their_team_ids = [m.get("championId", 0) for m in session.get("theirTeam", [])]

            # Translate numeric IDs into string names our model understands
            ally_champions = translate_champion_ids(my_team_ids)
            enemy_champions = translate_champion_ids(their_team_ids)

            result = {
                "status": "ACTIVE",
                "phase": phase,
                "ally_team": ally_champions,
                "enemy_team": enemy_champions,
            }

            if enemy_champions:
                recommendation = recommend_champion(enemy_champions, ally_champions, top_n)
                result["recommendation"] = recommendation
            else:
                result["recommendation"] = None
                result["message"] = "Waiting for enemy champions to be revealed..."

            return result

        # Champ select reported but session not yet readable -> treat as lobby.
        return {"status": "LOBBY", "phase": phase, "message": "Entering champ select..."}

    # Stage 1 (client / lobby / queue / ready-check) -> LOBBY (pre-match overlay).
    return {"status": "LOBBY", "phase": phase, "message": "In client."}


# ----------------------------------------------------------------------------
# Live in-game performance stats (League "Live Client Data API", port 2999).
# ----------------------------------------------------------------------------
# This local API only exists while the player is actually in an active game.
# It serves a self-signed certificate, so every request uses verify=False
# (InsecureRequestWarning is already silenced above).
LIVE_CLIENT_BASE = "https://127.0.0.1:2999/liveclientdata"


def _live_get(path: str):
    """GET a Live Client Data API path, ignoring the self-signed cert.

    Returns the parsed JSON on HTTP 200, or None on any failure (not in game,
    connection refused, timeout, non-200, bad JSON).
    """
    try:
        resp = requests.get(f"{LIVE_CLIENT_BASE}{path}", verify=False, timeout=2)
        if resp.status_code == 200:
            return resp.json()
    except (requests.exceptions.RequestException, ValueError):
        pass
    return None


def _live_get_by_player(path: str, summoner_name: str, riot_id: str):
    """GET a player-scoped Live Client path (e.g. /playerscores, /playeritems).

    Tries summonerName (older API) first, then riotId (newer API) as a fallback.
    """
    data = None
    if summoner_name:
        data = _live_get(f"{path}?summonerName={requests.utils.quote(summoner_name)}")
    if data is None and riot_id:
        data = _live_get(f"{path}?riotId={requests.utils.quote(riot_id)}")
    return data


# ----------------------------------------------------------------------------
# Item progression guide
# ----------------------------------------------------------------------------
# Optimal core 3-item build paths per champion. Each core item lists its major
# recipe components so we can recommend the next affordable sub-purchase.
# Prices are approximate shop values (replaceable with Data Dragon later).
BUILD_PATHS = {
    "Jinx": [
        {"id": 6672, "name": "Kraken Slayer", "price": 3000, "components": [
            {"id": 1043, "name": "Recurve Bow", "price": 1000},
            {"id": 1037, "name": "Pickaxe", "price": 875},
            {"id": 1018, "name": "Cloak of Agility", "price": 600}]},
        {"id": 3031, "name": "Infinity Edge", "price": 3450, "components": [
            {"id": 1038, "name": "B.F. Sword", "price": 1300},
            {"id": 1037, "name": "Pickaxe", "price": 875},
            {"id": 1018, "name": "Cloak of Agility", "price": 600}]},
        {"id": 3094, "name": "Rapid Firecannon", "price": 2500, "components": [
            {"id": 1043, "name": "Recurve Bow", "price": 1000},
            {"id": 1042, "name": "Dagger", "price": 300},
            {"id": 1018, "name": "Cloak of Agility", "price": 600}]},
    ],
    "Caitlyn": [
        {"id": 3031, "name": "Infinity Edge", "price": 3450, "components": [
            {"id": 1038, "name": "B.F. Sword", "price": 1300},
            {"id": 1037, "name": "Pickaxe", "price": 875},
            {"id": 1018, "name": "Cloak of Agility", "price": 600}]},
        {"id": 3094, "name": "Rapid Firecannon", "price": 2500, "components": [
            {"id": 1043, "name": "Recurve Bow", "price": 1000},
            {"id": 1042, "name": "Dagger", "price": 300},
            {"id": 1018, "name": "Cloak of Agility", "price": 600}]},
        {"id": 3036, "name": "Lord Dominik's Regards", "price": 3000, "components": [
            {"id": 3035, "name": "Last Whisper", "price": 1450},
            {"id": 1018, "name": "Cloak of Agility", "price": 600}]},
    ],
    "Kai'Sa": [
        {"id": 6672, "name": "Kraken Slayer", "price": 3000, "components": [
            {"id": 1043, "name": "Recurve Bow", "price": 1000},
            {"id": 1037, "name": "Pickaxe", "price": 875},
            {"id": 1018, "name": "Cloak of Agility", "price": 600}]},
        {"id": 3115, "name": "Nashor's Tooth", "price": 3000, "components": [
            {"id": 1043, "name": "Recurve Bow", "price": 1000},
            {"id": 1026, "name": "Blasting Wand", "price": 850},
            {"id": 1052, "name": "Amplifying Tome", "price": 435}]},
        {"id": 3089, "name": "Rabadon's Deathcap", "price": 3600, "components": [
            {"id": 1058, "name": "Needlessly Large Rod", "price": 1250},
            {"id": 1026, "name": "Blasting Wand", "price": 850},
            {"id": 1052, "name": "Amplifying Tome", "price": 435}]},
    ],
    "Aatrox": [
        {"id": 6692, "name": "Eclipse", "price": 2900, "components": [
            {"id": 3134, "name": "Serrated Dirk", "price": 1100},
            {"id": 1036, "name": "Long Sword", "price": 350},
            {"id": 1037, "name": "Pickaxe", "price": 875}]},
        {"id": 6610, "name": "Sundered Sky", "price": 3100, "components": [
            {"id": 3133, "name": "Caulfield's Warhammer", "price": 1100},
            {"id": 3067, "name": "Kindlegem", "price": 800},
            {"id": 1036, "name": "Long Sword", "price": 350}]},
        {"id": 3071, "name": "Black Cleaver", "price": 3000, "components": [
            {"id": 3133, "name": "Caulfield's Warhammer", "price": 1100},
            {"id": 1011, "name": "Giant's Belt", "price": 900},
            {"id": 1036, "name": "Long Sword", "price": 350}]},
    ],
    "Darius": [
        {"id": 6631, "name": "Stridebreaker", "price": 3300, "components": [
            {"id": 3077, "name": "Tiamat", "price": 1200},
            {"id": 3067, "name": "Kindlegem", "price": 800},
            {"id": 1036, "name": "Long Sword", "price": 350}]},
        {"id": 3071, "name": "Black Cleaver", "price": 3000, "components": [
            {"id": 3133, "name": "Caulfield's Warhammer", "price": 1100},
            {"id": 1011, "name": "Giant's Belt", "price": 900},
            {"id": 1036, "name": "Long Sword", "price": 350}]},
        {"id": 3053, "name": "Sterak's Gage", "price": 3200, "components": [
            {"id": 1011, "name": "Giant's Belt", "price": 900},
            {"id": 1037, "name": "Pickaxe", "price": 875}]},
    ],
    "Ahri": [
        {"id": 6655, "name": "Luden's Companion", "price": 3200, "components": [
            {"id": 3802, "name": "Lost Chapter", "price": 1300},
            {"id": 1026, "name": "Blasting Wand", "price": 850},
            {"id": 1052, "name": "Amplifying Tome", "price": 435}]},
        {"id": 4645, "name": "Shadowflame", "price": 3200, "components": [
            {"id": 1058, "name": "Needlessly Large Rod", "price": 1250},
            {"id": 1026, "name": "Blasting Wand", "price": 850},
            {"id": 1052, "name": "Amplifying Tome", "price": 435}]},
        {"id": 3089, "name": "Rabadon's Deathcap", "price": 3600, "components": [
            {"id": 1058, "name": "Needlessly Large Rod", "price": 1250},
            {"id": 1026, "name": "Blasting Wand", "price": 850},
            {"id": 1052, "name": "Amplifying Tome", "price": 435}]},
    ],
    "Zed": [
        {"id": 3142, "name": "Youmuu's Ghostblade", "price": 2800, "components": [
            {"id": 3134, "name": "Serrated Dirk", "price": 1100},
            {"id": 3133, "name": "Caulfield's Warhammer", "price": 1100}]},
        {"id": 6692, "name": "Eclipse", "price": 2900, "components": [
            {"id": 3134, "name": "Serrated Dirk", "price": 1100},
            {"id": 1036, "name": "Long Sword", "price": 350},
            {"id": 1037, "name": "Pickaxe", "price": 875}]},
        {"id": 6694, "name": "Serylda's Grudge", "price": 3000, "components": [
            {"id": 3035, "name": "Last Whisper", "price": 1450},
            {"id": 3133, "name": "Caulfield's Warhammer", "price": 1100}]},
    ],
    "Ezreal": [
        {"id": 3004, "name": "Manamune", "price": 2900, "components": [
            {"id": 3070, "name": "Tear of the Goddess", "price": 400},
            {"id": 1037, "name": "Pickaxe", "price": 875},
            {"id": 1036, "name": "Long Sword", "price": 350}]},
        {"id": 3078, "name": "Trinity Force", "price": 3333, "components": [
            {"id": 3057, "name": "Sheen", "price": 700},
            {"id": 3044, "name": "Phage", "price": 1100},
            {"id": 3067, "name": "Kindlegem", "price": 800}]},
        {"id": 3036, "name": "Lord Dominik's Regards", "price": 3000, "components": [
            {"id": 3035, "name": "Last Whisper", "price": 1450},
            {"id": 1018, "name": "Cloak of Agility", "price": 600}]},
    ],
}


def _find_active_champion(playerlist, summoner_name: str, riot_id: str) -> str:
    """Locate the active player in /playerlist and return their championName."""
    if not isinstance(playerlist, list):
        return ""
    for p in playerlist:
        names = {p.get("summonerName", ""), p.get("riotIdGameName", ""), p.get("riotId", "")}
        if (summoner_name and summoner_name in names) or (riot_id and riot_id in names):
            return p.get("championName", "") or ""
    return ""


def compute_item_progression(champion_name: str, owned_ids: set, current_gold: int):
    """Given the player's champion, the item IDs they already hold, and their
    unspent gold, return (next_recommended_buy, build_path_status).

    - Completed core items are filtered out of the recommendation.
    - If the player can afford the remaining cost of the next core item, that
      full item is recommended. Otherwise the next best affordable component is
      recommended (or the cheapest missing one, with the gold still needed).
    """
    path = BUILD_PATHS.get(champion_name)
    if not path:
        return None, []

    # Checklist status for every core item in the path.
    build_path_status = [
        {"id": core["id"], "name": core["name"], "owned": core["id"] in owned_ids}
        for core in path
    ]

    # The first core item the player has NOT completed is the current target.
    target = next((core for core in path if core["id"] not in owned_ids), None)
    if target is None:
        # Entire core build finished.
        return None, build_path_status

    # Discount the target's cost by the value of components already owned.
    owned_value = sum(c["price"] for c in target["components"] if c["id"] in owned_ids)
    remaining_cost = max(0, target["price"] - owned_value)

    if current_gold >= remaining_cost:
        # Enough banked to complete the item outright.
        next_buy = {
            "item_name": target["name"],
            "item_id": target["id"],
            "gold_needed": 0,
            "is_completed_item": True,
        }
        return next_buy, build_path_status

    # Not enough for the full item -> recommend the next sub-component.
    missing = [c for c in target["components"] if c["id"] not in owned_ids]
    if not missing:
        # No components left but still short (odd) -> point at the full item.
        return (
            {
                "item_name": target["name"],
                "item_id": target["id"],
                "gold_needed": max(0, remaining_cost - current_gold),
                "is_completed_item": True,
            },
            build_path_status,
        )

    affordable = [c for c in missing if current_gold >= c["price"]]
    if affordable:
        # Buy the biggest component they can afford right now.
        comp = max(affordable, key=lambda c: c["price"])
        gold_needed = 0
    else:
        # Nothing affordable yet -> next goal is the cheapest missing component.
        comp = min(missing, key=lambda c: c["price"])
        gold_needed = max(0, comp["price"] - current_gold)

    next_buy = {
        "item_name": comp["name"],
        "item_id": comp["id"],
        "gold_needed": gold_needed,
        "is_completed_item": False,
    }
    return next_buy, build_path_status


@app.get("/api/live-match-stats")
def get_live_match_stats():
    """Poll the local League Live Client Data API for the active player's
    real-time farm/economy stats (CS, gold, and per-minute averages).

    Status values:
        - "IN_GAME":     stats successfully read from the live game.
        - "NOT_IN_GAME": the live game API is unreachable (no active match).
    """
    # Phase 1: fetch active player + game stats + player list concurrently.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        fut_active = pool.submit(_live_get, "/activeplayer")
        fut_stats = pool.submit(_live_get, "/gamestats")
        fut_players = pool.submit(_live_get, "/playerlist")
        active = fut_active.result()
        stats = fut_stats.result()
        playerlist = fut_players.result()

    # If neither endpoint answered, the player is not in a live game.
    if active is None and stats is None:
        return {"status": "NOT_IN_GAME", "message": "Live game API not reachable."}

    # Active-player identity + spendable gold. Newer clients expose
    # riotIdGameName; older builds use summonerName. Fall back gracefully.
    summoner_name = ""
    current_gold = 0.0
    riot_id = ""
    if active:
        summoner_name = active.get("summonerName") or active.get("riotIdGameName") or ""
        riot_id = active.get("riotId") or ""
        current_gold = float(active.get("currentGold", 0) or 0)

    # Match duration in seconds (float).
    game_time = float(stats.get("gameTime", 0) or 0) if stats else 0.0

    # Phase 2: player scores (CS) and player items (for gold spent) both require
    # the player's name — fetch them concurrently.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        fut_scores = pool.submit(_live_get_by_player, "/playerscores", summoner_name, riot_id)
        fut_items = pool.submit(_live_get_by_player, "/playeritems", summoner_name, riot_id)
        scores = fut_scores.result()
        items = fut_items.result()

    creep_score = int(scores.get("creepScore", 0) or 0) if scores else 0

    # Total gold EARNED = unspent gold + shop value of every item currently held.
    # Each item looks like {"itemID": 3031, "price": 3400, "count": 1}. Base
    # trinkets / free wards report price 0, so they contribute nothing.
    spent_gold = 0
    owned_ids = set()
    if isinstance(items, list):
        for item in items:
            spent_gold += int(item.get("price", 0) or 0) * int(item.get("count", 1) or 1)
            item_id = item.get("itemID")
            if item_id is not None:
                owned_ids.add(int(item_id))

    total_gold_earned = int(current_gold + spent_gold)

    # Item progression guide: which item/component to buy next.
    champion_name = _find_active_champion(playerlist, summoner_name, riot_id)
    next_recommended_buy, build_path = compute_item_progression(
        champion_name, owned_ids, int(current_gold)
    )

    # Real-time averages, guarding against division by zero at game start.
    game_minutes = game_time / 60.0
    if game_minutes < 0.1:
        cs_per_min = 0.0
        gold_per_min = 0.0
    else:
        cs_per_min = round(creep_score / game_minutes, 1)
        gold_per_min = round(total_gold_earned / game_minutes, 1)

    # Human-friendly MM:SS clock.
    total_seconds = int(game_time)
    game_time_formatted = f"{total_seconds // 60:02d}:{total_seconds % 60:02d}"

    return {
        "status": "IN_GAME",
        "summonerName": summoner_name,
        "gameTime": game_time,
        "gameTimeFormatted": game_time_formatted,
        "currentGold": int(current_gold),
        "totalGoldEarned": total_gold_earned,
        "creepScore": creep_score,
        "csPerMin": cs_per_min,
        "goldPerMin": gold_per_min,
        "championName": champion_name,
        "build_path": build_path,
        "next_recommended_buy": next_recommended_buy,
    }


# ----------------------------------------------------------------------------
# Entry point for the frozen (PyInstaller) binary.
# ----------------------------------------------------------------------------
# When bundled as main.exe and spawned by Electron, run the ASGI server here.
# In development you can instead use: uvicorn main:app --reload
if __name__ == "__main__":
    import uvicorn

    # log_config=None disables Uvicorn's default logging dictConfig, which
    # otherwise fails under --noconsole (no real stdout/stderr to attach).
    logger.info("Serving on http://%s:%d", config.BACKEND_HOST, config.BACKEND_PORT)
    uvicorn.run(app, host=config.BACKEND_HOST, port=config.BACKEND_PORT, log_config=None)