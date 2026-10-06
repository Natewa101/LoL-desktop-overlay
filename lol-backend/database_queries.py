import sqlite3
import sys
from pathlib import Path
from typing import List, Dict, Optional
import pickle
import numpy as np


def resource_path(filename: str) -> Path:
    """Resolve a bundled data file's absolute path.

    When running as a PyInstaller --onefile binary, data files added via
    --add-data are unpacked into a temporary folder exposed as sys._MEIPASS.
    Otherwise (normal Python execution) we resolve relative to this module.
    """
    if getattr(sys, 'frozen', False):
        base_path = Path(sys._MEIPASS)
    else:
        base_path = Path(__file__).parent
    return base_path / filename

def get_matchup_winrate(champion_id: int, enemy_champion_id: int) -> Dict:
    """Query the database to get winrate for a specific champion matchup."""
    db_path = resource_path('league_database.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Query matchups table for this specific matchup
        query = """
        SELECT 
            COUNT(*) as total_games,
            SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) as wins,
            ROUND(SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as winrate
        FROM matchups
        WHERE champion_id = ? AND enemy_champion_id = ?
        """
        
        cursor.execute(query, (champion_id, enemy_champion_id))
        result = cursor.fetchone()
        
        total_games, wins, winrate = result
        
        if total_games == 0:
            return {
                "total_games": 0,
                "wins": 0,
                "winrate": 0.0,
                "message": "No matchup data found"
            }
        
        return {
            "total_games": total_games,
            "wins": wins,
            "winrate": winrate
        }
        
    finally:
        conn.close()

def get_winning_items(champion_id: int, enemy_champion_id: int, top_n: int = 5) -> List[Dict]:
    """Query the database to get most common items when champion wins this matchup."""
    db_path = resource_path('league_database.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # First get the game IDs where this champion won against this enemy
        query = """
        SELECT DISTINCT game_id
        FROM matchups
        WHERE champion_id = ? AND enemy_champion_id = ? AND win = 1
        """
        
        cursor.execute(query, (champion_id, enemy_champion_id))
        winning_game_ids = [row[0] for row in cursor.fetchall()]
        
        if not winning_game_ids:
            return []
        
        # Filter out wards, trinkets, and starting items
        excluded_items = [
            3340, 3361, 3362, 3363, 3364,  # Trinkets
            2055, 3330, 2050,              # Wards
            1001, 1004, 1028, 1029, 1031,  # Starting items (Doran's, etc.)
            1033, 1036, 1052, 1054, 1055,  # More starting items
            1056, 2003, 2010, 2011         # Potions and consumables
        ]
        excluded_placeholders = ','.join('?' * len(excluded_items))
        
        # Then get the items built by this champion in those winning games
        placeholders = ','.join('?' * len(winning_game_ids))
        item_query = f"""
        SELECT 
            item_id,
            COUNT(*) as build_count,
            ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM items WHERE game_id IN ({placeholders}) AND champion_id = ? AND item_id NOT IN ({excluded_placeholders})), 0), 2) as build_rate
        FROM items
        WHERE game_id IN ({placeholders}) AND champion_id = ? AND item_id NOT IN ({excluded_placeholders})
        GROUP BY item_id
        ORDER BY build_count DESC
        LIMIT ?
        """
        
        # Build the parameter list: winning_game_ids for both IN clauses, champion_id for subquery, excluded items, champion_id for main query, excluded items again, top_n for limit
        params = winning_game_ids + [champion_id] + excluded_items + winning_game_ids + [champion_id] + excluded_items + [top_n]
        cursor.execute(item_query, params)
        results = cursor.fetchall()
        
        items = []
        for item_id, build_count, build_rate in results:
            items.append({
                "item_id": item_id,
                "build_count": build_count,
                "build_rate": build_rate
            })
        
        return items
        
    finally:
        conn.close()

def get_matchup_analysis(champion_id: int, enemy_champion_id: int) -> Dict:
    """Get complete matchup analysis including winrate and winning items."""
    winrate_data = get_matchup_winrate(champion_id, enemy_champion_id)
    winning_items = get_winning_items(champion_id, enemy_champion_id)
    
    return {
        "champion_id": champion_id,
        "enemy_champion_id": enemy_champion_id,
        "winrate_data": winrate_data,
        "recommended_items": winning_items
    }

def get_champion_id_by_name(champion_name: str) -> Optional[int]:
    """Get champion ID by name from the players table."""
    db_path = resource_path('league_database.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Strip spaces from the input name for matching
        clean_name = champion_name.replace(' ', '')
        
        query = """
        SELECT DISTINCT champion_id
        FROM players
        WHERE LOWER(champion_name) = LOWER(?)
        LIMIT 1
        """
        
        cursor.execute(query, (clean_name,))
        result = cursor.fetchone()
        
        if result:
            return result[0]
        return None
        
    finally:
        conn.close()

def load_model():
    """Load the trained model and features from pickle files."""
    model_path = resource_path('draft_model.pkl')
    features_path = resource_path('model_features.pkl')
    
    try:
        with open(model_path, 'rb') as f:
            model = pickle.load(f)
        with open(features_path, 'rb') as f:
            all_champions = pickle.load(f)
        
        champion_to_index = {name: idx for idx, name in enumerate(all_champions)}
        return model, champion_to_index, all_champions
    except FileNotFoundError:
        return None, None, None

def recommend_champion(enemy_team: List[str], ally_team: List[str], top_n: int = 5) -> Dict:
    """Recommend the best champion to pick based on team composition."""
    model, champion_to_index, all_champions = load_model()
    
    if model is None:
        return {
            "status": "error",
            "message": "Model not found. Please train the model first."
        }
    
    # Get champion IDs and names from database
    enemy_champions = []
    ally_champions = []
    
    db_path = resource_path('league_database.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Process enemy team
        for champ_name in enemy_team:
            clean_name = champ_name.replace(' ', '')
            champ_id = get_champion_id_by_name(clean_name)
            if champ_id:
                cursor.execute("SELECT champion_name FROM players WHERE champion_id = ? LIMIT 1", (champ_id,))
                result = cursor.fetchone()
                if result:
                    enemy_champions.append(result[0])
        
        # Process ally team
        for champ_name in ally_team:
            clean_name = champ_name.replace(' ', '')
            champ_id = get_champion_id_by_name(clean_name)
            if champ_id:
                cursor.execute("SELECT champion_name FROM players WHERE champion_id = ? LIMIT 1", (champ_id,))
                result = cursor.fetchone()
                if result:
                    ally_champions.append(result[0])
        
    finally:
        conn.close()
    
    if not enemy_champions:
        return {
            "status": "error",
            "message": "No valid enemy champions provided."
        }
    
    # Get list of champions that are not already picked
    picked_champions = set(enemy_champions + ally_champions)
    available_champions = [champ for champ in all_champions if champ not in picked_champions]
    
    if not available_champions:
        return {
            "status": "error",
            "message": "No available champions to recommend."
        }
    
    # Score each available champion
    recommendations = []
    
    for champion in available_champions:
        # Create feature vector
        feature_vector = np.zeros(len(all_champions))
        
        # Mark enemy champions with -1
        for enemy_champ in enemy_champions:
            enemy_idx = champion_to_index.get(enemy_champ)
            if enemy_idx is not None:
                feature_vector[enemy_idx] = -1
        
        # Mark ally champions with 1
        for ally_champ in ally_champions:
            ally_idx = champion_to_index.get(ally_champ)
            if ally_idx is not None:
                feature_vector[ally_idx] = 1
        
        # Mark the candidate champion with 1
        candidate_idx = champion_to_index.get(champion)
        if candidate_idx is not None:
            feature_vector[candidate_idx] = 1
        
        # Get prediction
        prediction = model.predict_proba([feature_vector])[0]
        win_probability = prediction[1] * 100  # Probability of class 1 (win)
        
        recommendations.append({
            "champion": champion,
            "win_probability": round(win_probability, 2)
        })
    
    # Sort by win probability and return top N
    recommendations.sort(key=lambda x: x["win_probability"], reverse=True)
    top_recommendations = recommendations[:top_n]
    
    return {
        "status": "success",
        "enemy_team": enemy_champions,
        "ally_team": ally_champions,
        "recommendations": top_recommendations,
        "model_type": "Logistic Regression"
    }

def translate_champion_ids(champion_ids: List[int]) -> List[str]:
    """Convert a list of champion IDs to champion names."""
    result = []
    db_path = resource_path('league_database.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        for champ_id in champion_ids:
            if champ_id == 0:
                result.append("")
            else:
                cursor.execute("SELECT champion_name FROM players WHERE champion_id = ? LIMIT 1", (champ_id,))
                row = cursor.fetchone()
                result.append(row[0] if row else "")
    finally:
        conn.close()
    
    return result
