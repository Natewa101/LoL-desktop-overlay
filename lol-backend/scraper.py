from functools import lru_cache

from riotwatcher import LolWatcher, RiotWatcher, ApiError

from config import RIOT_API_KEY, RIOT_PLATFORM, RIOT_REGION

PLATFORM = RIOT_PLATFORM
REGIONAL = RIOT_REGION


@lru_cache(maxsize=1)
def _get_watchers():
    """Create the Riot API clients on first use so the backend can start without a key."""
    return LolWatcher(RIOT_API_KEY), RiotWatcher(RIOT_API_KEY)


def fetch_recent_matches(game_name: str, tag_line: str):
    """Fetches recent match data and returns it as a dictionary for the web server."""
    if not RIOT_API_KEY:
        return {"error": "RIOT_API_KEY is not configured. Add it to your .env file."}

    lol_watcher, riot_watcher = _get_watchers()
    try:
        # Step A: Find the Player PUUID
        account_info = riot_watcher.account.by_riot_id(REGIONAL, game_name, tag_line)
        user_puuid = account_info['puuid']

        # Step B: Get Match IDs
        match_ids = lol_watcher.match.matchlist_by_puuid(REGIONAL, user_puuid, count=5)
        if not match_ids:
            return {"error": "No recent matches found for this player."}

        # Step C: Get Deep Match Data
        latest_match_id = match_ids[0]
        match_details = lol_watcher.match.by_id(REGIONAL, latest_match_id)

        # Step D: Parse the 10 players into a clean list
        parsed_players = []
        players = match_details['info']['participants']
        
        for player in players:
            parsed_players.append({
                "name": player.get('riotIdGameName', 'Unknown'),
                "tag": player.get('riotIdTagline', '???'),
                "champion": player['championName'],
                "role": player['teamPosition'] if player['teamPosition'] else "UTILITY",
                "win": player['win'],
                "kills": player['kills'],
                "deaths": player['deaths'],
                "assists": player['assists']
            })

        # Return the ultimate packaged data box
        return {
            "match_id": latest_match_id,
            "game_mode": match_details['info']['gameMode'],
            "players": parsed_players
        }

    except ApiError as err:
        if err.response.status_code == 401:
            return {"error": "Backend API key unauthorized. Check spaces."}
        elif err.response.status_code == 403:
            return {"error": "Backend API key expired! Regenerate on Riot portal."}
        elif err.response.status_code == 404:
            return {"error": "Riot Account not found. Check spelling."}
        else:
            return {"error": f"Riot API Error: {err.response.status_code}"}