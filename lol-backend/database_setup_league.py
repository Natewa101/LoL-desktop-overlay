import pandas as pd
import sqlite3
from pathlib import Path

def setup_league_database():
    """Read league_data.xlsx and create indexed SQLite database tables."""
    
    # Read the dataset
    data_path = Path(__file__).parent / 'data' / 'league_data.xlsx'
    db_path = Path(__file__).parent / 'league_database.db'
    
    print(f"Reading dataset from {data_path}...")
    df = pd.read_excel(data_path)
    print(f"Loaded {len(df)} player records")
    print(f"Columns: {df.columns.tolist()}")
    
    # Select the columns the user requested plus additional useful columns
    requested_columns = [
        'game_id', 'participant_id', 'champion_id', 'champion_name',
        'team_id', 'win', 'individual_position', 'team_position',
        'item0', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6',
        'kills', 'deaths', 'assists', 'gold_earned', 'total_damage_dealt_to_champions'
    ]
    
    # Filter to only available columns
    available_columns = [col for col in requested_columns if col in df.columns]
    df_filtered = df[available_columns].copy()
    
    # Add enemy champion IDs by grouping by game_id and team_id
    print("Adding enemy champion IDs...")
    game_teams = df_filtered.groupby(['game_id', 'team_id'])['champion_id'].apply(list).reset_index()
    game_teams.columns = ['game_id', 'team_id', 'team_champions']
    
    def get_enemy_champions(row):
        """Get list of enemy champion IDs for a player."""
        enemy_teams = game_teams[(game_teams['game_id'] == row['game_id']) & 
                                 (game_teams['team_id'] != row['team_id'])]
        if not enemy_teams.empty:
            return enemy_teams.iloc[0]['team_champions']
        return []
    
    df_filtered['enemy_champions'] = df_filtered.apply(get_enemy_champions, axis=1).apply(lambda x: ','.join(map(str, x)) if isinstance(x, list) else '')
    
    # Create SQLite database
    print(f"Creating database at {db_path}...")
    conn = sqlite3.connect(db_path)
    
    # Create players table with requested columns
    df_filtered.to_sql('players', conn, if_exists='replace', index=False)
    
    # Create indexes for performance
    cursor = conn.cursor()
    
    print("Creating indexes...")
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_game_id ON players(game_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_champion_id ON players(champion_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_win ON players(win)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_team_id ON players(team_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_individual_position ON players(individual_position)')
    
    # Create a simplified matchups table for champion vs champion analysis
    print("Creating matchups table...")
    matchups = []
    
    # Group by game to get all champions on each team
    for game_id, game_group in df_filtered.groupby('game_id'):
        teams = game_group.groupby('team_id')['champion_id'].apply(list).to_dict()
        
        if len(teams) == 2:  # Only if there are 2 teams
            team_ids = list(teams.keys())
            team1_champs = teams[team_ids[0]]
            team2_champs = teams[team_ids[1]]
            
            # Get winner for this game
            winner_info = game_group.groupby('team_id')['win'].first().to_dict()
            team1_win = winner_info.get(team_ids[0], 0)
            
            # Create all champion matchups
            for champ1 in team1_champs:
                for champ2 in team2_champs:
                    matchups.append({
                        'game_id': game_id,
                        'champion_id': champ1,
                        'enemy_champion_id': champ2,
                        'win': team1_win
                    })
                    
                    # Also add reverse matchup
                    matchups.append({
                        'game_id': game_id,
                        'champion_id': champ2,
                        'enemy_champion_id': champ1,
                        'win': 1 - team1_win
                    })
    
    matchups_df = pd.DataFrame(matchups)
    if not matchups_df.empty:
        matchups_df.to_sql('matchups', conn, if_exists='replace', index=False)
        
        # Create indexes for matchups table
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_matchup_game ON matchups(game_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_matchup_champion ON matchups(champion_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_matchup_enemy ON matchups(enemy_champion_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_matchup_win ON matchups(win)')
        
        print(f"- Matchups table: {len(matchups_df)} records")
    
    # Create items table for item analysis
    print("Creating items table...")
    items_records = []
    for _, row in df_filtered.iterrows():
        for item_slot in ['item0', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6']:
            item_id = row.get(item_slot)
            if pd.notna(item_id) and item_id != 0:  # 0 means no item
                items_records.append({
                    'game_id': row['game_id'],
                    'participant_id': row['participant_id'],
                    'champion_id': row['champion_id'],
                    'item_slot': item_slot,
                    'item_id': int(item_id),
                    'win': row['win']
                })
    
    items_df = pd.DataFrame(items_records)
    if not items_df.empty:
        items_df.to_sql('items', conn, if_exists='replace', index=False)
        
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_items_champion ON items(champion_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_items_item_id ON items(item_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_items_win ON items(win)')
        
        print(f"- Items table: {len(items_df)} records")
    
    conn.commit()
    conn.close()
    
    print(f"\nDatabase setup complete!")
    print(f"- Players table: {len(df_filtered)} records")
    print(f"- Matchups table: {len(matchups_df) if not matchups_df.empty else 0} records")
    print(f"- Items table: {len(items_df) if not items_df.empty else 0} records")
    print(f"\nAvailable columns: champion_id, enemy_champion_ids, win_status, item0-item6")
    print(f"Note: Primary rune data is not available in this dataset.")

if __name__ == "__main__":
    setup_league_database()
