import sqlite3
import pandas as pd
import numpy as np
import pickle
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / 'league_database.db'
MODEL_PATH = BASE_DIR / 'draft_model.pkl'
FEATURES_PATH = BASE_DIR / 'model_features.pkl'

def train_draft_predictor():
    print("Extracting game records from SQLite database...")
    conn = sqlite3.connect(DB_PATH)
    
    # Query all raw match performance data from matchups table
    query = "SELECT game_id, champion_id, enemy_champion_id, win FROM matchups"
    df = pd.read_sql_query(query, conn)
    conn.close()

    if df.empty:
        print("Error: Your database is empty!")
        return

    print("Restructuring player data into feature matrices...")
    # Get unique games and their outcomes
    game_outcomes = df.groupby('game_id')['win'].first().reset_index()
    y = game_outcomes['win'].astype(int)
    
    # Get all unique champions from players table
    conn = sqlite3.connect(DB_PATH)
    champions_query = "SELECT DISTINCT champion_name FROM players"
    champions_df = pd.read_sql_query(champions_query, conn)
    conn.close()
    
    all_champions = sorted(champions_df['champion_name'].unique())
    champion_to_index = {name: idx for idx, name in enumerate(all_champions)}

    # Create feature matrix
    valid_game_ids = game_outcomes['game_id'].values
    X = np.zeros((len(valid_game_ids), len(all_champions)))

    print("Mapping champion compositions to numerical features...")
    for row in df.itertuples():
        if row.game_id in valid_game_ids:
            game_idx = np.where(valid_game_ids == row.game_id)[0][0]
            # Get champion name from champion_id
            conn = sqlite3.connect(DB_PATH)
            champ_query = f"SELECT champion_name FROM players WHERE champion_id = {row.champion_id} LIMIT 1"
            champ_result = pd.read_sql_query(champ_query, conn)
            conn.close()
            
            if not champ_result.empty:
                champ_name = champ_result['champion_name'].iloc[0]
                champ_idx = champion_to_index.get(champ_name)
                
                if champ_idx is not None:
                    # 1 if champion won, 0 if lost
                    X[game_idx, champ_idx] = row.win

    print(f"Data ready! Matrix Shape: {X.shape}. Splitting datasets...")
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    print("Training the Logistic Regression model...")
    model = LogisticRegression(C=0.5, max_iter=1000)
    model.fit(X_train, y_train)

    # Verify model performance
    predictions = model.predict(X_test)
    accuracy = accuracy_score(y_test, predictions)
    print(f"Model training complete! Prediction Accuracy: {accuracy * 100:.2f}%")

    print("Saving AI model assets...")
    # Save the model
    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(model, f)
    # Save the champion index structure
    with open(FEATURES_PATH, 'wb') as f:
        pickle.dump(all_champions, f)
        
    print("AI setup complete! Ready for predictive drafts.")

if __name__ == "__main__":
    train_draft_predictor()