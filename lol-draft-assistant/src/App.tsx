import React, { useState, useEffect, useRef } from 'react';
import HextechOverlay from './components/HextechOverlay';
import AppLayoutWrapper from './components/AppLayoutWrapper';
import { API_BASE_URL, DDRAGON_VERSION } from './config';

interface RecommendedItem {
  item_id: number;
  build_count: number;
  build_rate: number;
}

interface MatchupResult {
  status: string;
  my_champion: string;
  enemy_champion: string;
  predicted_winrate: number;
  total_games: number;
  recommended_items: RecommendedItem[];
}

interface ChampionRecommendation {
  champion: string;
  win_probability: number;
}

interface TeamRecommendationResult {
  status: string;
  enemy_team: string[];
  ally_team: string[];
  recommendations: ChampionRecommendation[];
  model_type: string;
}

interface LiveDraftState {
  status: 'OFFLINE' | 'LOBBY' | 'ACTIVE' | 'GAME';
  // Raw LCU gameflow phase, e.g. "ChampSelect", "GameStart", "InProgress".
  phase?: string;
  message?: string;
  ally_team?: string[];
  enemy_team?: string[];
  recommendation?: TeamRecommendationResult;
}

// Real-time farm/economy stats from the local Live Client Data API,
// surfaced by the backend at /api/live-match-stats.
interface LiveMatchStats {
  status: 'IN_GAME' | 'NOT_IN_GAME';
  summonerName?: string;
  gameTime?: number;
  gameTimeFormatted?: string;
  currentGold?: number;
  totalGoldEarned?: number;
  creepScore?: number;
  csPerMin?: number;
  goldPerMin?: number;
  championName?: string;
  build_path?: { id: number; name: string; owned: boolean }[];
  next_recommended_buy?: {
    item_name: string;
    item_id: number;
    gold_needed: number;
    is_completed_item: boolean;
  } | null;
}

// The two distinct layout phases the single window can present.
type OverlayView = 'PRE_MATCH' | 'POST_MATCH';

// Shape of the IPC bridge exposed by preload.cjs via contextBridge.
declare global {
  interface Window {
    electronAPI?: {
      setOverlayMode: (mode: OverlayView) => void;
      setMouseIgnore: (ignore: boolean) => void;
      isElectron: boolean;
    };
  }
}

function App() {
  const [myChamp, setMyChamp] = useState('');
  const [enemyChamp, setEnemyChamp] = useState('');
  const [result, setResult] = useState<MatchupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showResults, setShowResults] = useState(false);
  
  // Team recommendation state
  const [activeTab, setActiveTab] = useState('matchup');
  const [enemyTeam, setEnemyTeam] = useState('');
  const [allyTeam, setAllyTeam] = useState('');
  const [teamResult, setTeamResult] = useState<TeamRecommendationResult | null>(null);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState('');

  // Live draft polling state
  const [liveDraft, setLiveDraft] = useState<LiveDraftState | null>(null);

  // Active layout phase. Defaults to the drafting dashboard until the LCU
  // poller reports the game has started.
  const [currentView, setCurrentView] = useState<OverlayView>('PRE_MATCH');

  // Real-time in-game farm/economy stats (only polled during POST_MATCH).
  const [matchStats, setMatchStats] = useState<LiveMatchStats | null>(null);

  // Track backend reachability so polling failures are logged once, not every tick.
  const backendDownRef = useRef(false);

  // Poll LCU for live draft state every 2 seconds
  useEffect(() => {
    const pollLiveDraft = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/live-client-draft?top_n=5`);
        const data = await response.json();
        setLiveDraft(data);
        if (backendDownRef.current) {
          backendDownRef.current = false;
          console.info(`[backend] connection restored (${API_BASE_URL})`);
        }
      } catch (err) {
        if (!backendDownRef.current) {
          backendDownRef.current = true;
          console.warn(`[backend] unreachable at ${API_BASE_URL}; retrying every 2s`, err);
        }
      }
    };

    const interval = setInterval(pollLiveDraft, 2000);
    pollLiveDraft(); // Initial poll

    return () => clearInterval(interval);
  }, []);

  // Layout traffic controller: translate the polled LCU phase into a layout
  // view and drive the single Electron window's size/position over IPC.
  //   status 'GAME'  -> match started -> POST_MATCH fullscreen overlay
  //   anything else  -> drafting/lobby/offline -> PRE_MATCH dashboard
  // Keyed on the status string so we only fire on a genuine phase change,
  // never on every 2s poll.
  useEffect(() => {
    const nextView: OverlayView =
      liveDraft?.status === 'GAME' ? 'POST_MATCH' : 'PRE_MATCH';

    setCurrentView((prev) => {
      if (prev === nextView) return prev;
      // Notify the main process to reshape the window for the new phase.
      window.electronAPI?.setOverlayMode(nextView);
      return nextView;
    });
  }, [liveDraft?.status]);

  // Poll the live game (Live Client Data API via backend) for real-time
  // farm/economy stats every 2.5s, but ONLY while the in-game overlay is
  // active. This avoids hammering the local game API outside of matches.
  useEffect(() => {
    if (currentView !== 'POST_MATCH') {
      setMatchStats(null);
      return;
    }

    let failed = false;
    const pollMatchStats = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/live-match-stats`);
        const data: LiveMatchStats = await response.json();
        setMatchStats(data);
        failed = false;
      } catch (err) {
        if (!failed) {
          failed = true;
          console.warn('[live-match-stats] poll failed; retrying', err);
        }
      }
    };

    const interval = setInterval(pollMatchStats, 2500);
    pollMatchStats(); // Initial fetch on entering the overlay

    return () => clearInterval(interval);
  }, [currentView]);

  const getChampionImageUrl = (championName: string) => {
    if (!championName) return '';

    // 1. Strip spaces, apostrophes, and periods, then force lowercase for safe checking
    const cleanInput = championName.replace(/[\s\-\.\']/g, '').toLowerCase();

    // 2. Map lowercase inputs to Riot's EXACT Case-Sensitive file names
    const exactRiotNames: { [key: string]: string } = {
      'wukong': 'MonkeyKing',
      'monkeyking': 'MonkeyKing',
      'fiddlesticks': 'FiddleSticks',
      'renata': 'Renata', // Riot uses Renata.png, not RenataGlasc.png
      'renataglasc': 'Renata',
      'belveth': 'Belveth',
      'aurelionsol': 'AurelionSol',
      'jarvaniv': 'JarvanIV',
      'leesin': 'LeeSin',
      'masteryi': 'MasterYi',
      'missfortune': 'MissFortune',
      'tahmkench': 'TahmKench',
      'twistedfate': 'TwistedFate',
      'xinzhao': 'XinZhao',
      'nunu': 'Nunu',
      'nunuandwillump': 'Nunu',
      'kogmaw': 'KogMaw',
      'reksai': 'RekSai',
      'velkoz': 'Velkoz',   // Notice the lowercase 'k' in Riot's file
      'kaisa': 'Kaisa',     // Notice the lowercase 's' in Riot's file
      'khazix': 'Khazix',
      'chogath': 'Chogath',
      'drmundo': 'DrMundo',
      'ksante': 'KSante'
    };

    // 3. Check the map. If it's a standard champion, just capitalize the first letter.
    let finalName = exactRiotNames[cleanInput];
    
    if (!finalName) {
      // Transforms "aatrox" into "Aatrox"
      finalName = cleanInput.charAt(0).toUpperCase() + cleanInput.slice(1);
    }

    return `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${finalName}.png`;
  };

  const formatChampionName = (championName: string) => {
    if (!championName) return '';

    // Map database names to display names with spaces
    const displayNames: { [key: string]: string } = {
      'MissFortune': 'Miss Fortune',
      'MasterYi': 'Master Yi',
      'LeeSin': 'Lee Sin',
      'TwistedFate': 'Twisted Fate',
      'TahmKench': 'Tahm Kench',
      'JarvanIV': 'Jarvan IV',
      'XinZhao': 'Xin Zhao',
      'KogMaw': 'Kog Maw',
      'RekSai': 'Rek Sai',
      'Velkoz': 'Vel Koz',
      'Khazix': 'Kha Zix',
      'Chogath': 'Cho Gath',
      'DrMundo': 'Dr. Mundo',
      'AurelionSol': 'Aurelion Sol',
      'Nunu': 'Nunu & Willump',
      'Renata': 'Renata Glasc',
      'Kaisa': 'Kai Sa',
      'MonkeyKing': 'Wukong',
      'Belveth': 'Bel Veth',
      'KSante': 'K Sante'
    };

    const displayName = displayNames[championName] || championName;
    
    // Convert to title case (first letter of each word capitalized)
    return displayName
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };
  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myChamp || !enemyChamp) {
      setError('Enter both champions');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/matchup-analysis?my_champ=${encodeURIComponent(myChamp)}&enemy_champ=${encodeURIComponent(enemyChamp)}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Analysis failed');
      }

      setResult(data);
      setShowResults(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setShowResults(false);
    setResult(null);
    setError('');
    setMyChamp('');
    setEnemyChamp('');
  };

  const handleTeamRecommendation = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const enemyTeamList = enemyTeam.split(',').map(champ => champ.trim()).filter(champ => champ !== '');
    const allyTeamList = allyTeam.split(',').map(champ => champ.trim()).filter(champ => champ !== '');

    if (enemyTeamList.length === 0) {
      setTeamError('Enter at least 1 enemy champion');
      return;
    }

    setTeamLoading(true);
    setTeamError('');
    setTeamResult(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/team-recommendation?enemy_team=${encodeURIComponent(enemyTeamList.join(','))}&ally_team=${encodeURIComponent(allyTeamList.join(','))}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Recommendation failed');
      }

      setTeamResult(data);
    } catch (err: any) {
      setTeamError(err.message);
    } finally {
      setTeamLoading(false);
    }
  };

  // Preview mode: open the app with ?overlay=1 to view the Hextech overlay
  // against a dark canvas without being in a live game (for design iteration).
  const previewOverlay =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('overlay') === '1';

  if (previewOverlay) {
    // Preview mirrors the POST_MATCH overlay view (no drag handle).
    return (
      <AppLayoutWrapper showDragHandle={false}>
        <div style={{ minHeight: '100vh', background: '#0A1428' }}>
          <HextechOverlay />
        </div>
      </AppLayoutWrapper>
    );
  }

  // POST_MATCH: transparent fullscreen Hextech overlay so the game shows
  // through. Drag handle is disabled so it never intercepts in-game input.
  if (currentView === 'POST_MATCH') {
    // Map the live stats into the overlay's `tempo` panel shape. Falls back to
    // the panel's own mock data until the first successful in-game read.
    const overlayData =
      matchStats?.status === 'IN_GAME'
        ? {
            tempo: {
              csPerMin: matchStats.csPerMin ?? 0,
              goldPerMin: matchStats.goldPerMin ?? 0,
              totalCs: matchStats.creepScore ?? 0,
              totalGold: matchStats.totalGoldEarned ?? 0,
              gameTime: matchStats.gameTimeFormatted ?? '00:00',
            },
            itemGuide: {
              championName: matchStats.championName ?? '',
              currentGold: matchStats.currentGold ?? 0,
              buildPath: matchStats.build_path ?? [],
              nextBuy: matchStats.next_recommended_buy ?? null,
            },
          }
        : undefined;

    return (
      <AppLayoutWrapper showDragHandle={false}>
        <HextechOverlay data={overlayData} />
      </AppLayoutWrapper>
    );
  }

  // PRE_MATCH: the drafting dashboard, with the drag handle enabled.
  return (
    <AppLayoutWrapper showDragHandle={true}>
    <div style={{
      minHeight: '100vh',
      backgroundColor: 'rgba(10, 10, 12, 0.85)',
      fontFamily: 'Arial, sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '500px',
        backgroundColor: 'rgba(20, 20, 25, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        padding: '40px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
      }}>
        <h1 style={{
          fontSize: '24px',
          color: '#ffffff',
          margin: '0 0 10px 0',
          textAlign: 'center'
        }}>
          Champion Matchup Analyzer
        </h1>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', justifyContent: 'center' }}>
          <button
            onClick={() => setActiveTab('matchup')}
            style={{
              padding: '10px 20px',
              backgroundColor: activeTab === 'matchup' ? '#0066cc' : '#e0e0e0',
              color: activeTab === 'matchup' ? '#ffffff' : '#000000',
              border: 'none',
              borderRadius: '4px',
              fontSize: '16px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Matchup Analysis
          </button>
          <button
            onClick={() => setActiveTab('team')}
            style={{
              padding: '10px 20px',
              backgroundColor: activeTab === 'team' ? '#0066cc' : '#e0e0e0',
              color: activeTab === 'team' ? '#ffffff' : '#000000',
              border: 'none',
              borderRadius: '4px',
              fontSize: '16px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Team Recommendation
          </button>
        </div>

        {activeTab === 'matchup' && !showResults && (
          <form onSubmit={handleAnalyze} style={{ marginBottom: '20px' }}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', color: '#ffffff' }}>
              Your Champion:
            </label>
            <input
              type="text"
              value={myChamp}
              onChange={(e) => setMyChamp(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #cccccc',
                borderRadius: '4px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', color: '#ffffff' }}>
              Enemy Champion:
            </label>
            <input
              type="text"
              value={enemyChamp}
              onChange={(e) => setEnemyChamp(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #cccccc',
                borderRadius: '4px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: loading ? '#cccccc' : '#0066cc',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '16px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
          >
            {loading ? 'Analyzing...' : 'Analyze Matchup'}
          </button>
        </form>
        )}

        {error && !showResults && (
          <div style={{
            padding: '10px',
            backgroundColor: '#ffcccc',
            border: '1px solid #ff0000',
            borderRadius: '4px',
            color: '#cc0000',
            marginBottom: '20px'
          }}>
            {error}
          </div>
        )}

        {/* Team Recommendation Form */}
        {activeTab === 'team' && (
          <form onSubmit={handleTeamRecommendation} style={{ marginBottom: '20px' }}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', color: '#ffffff' }}>
              Enemy Team (comma-separated):
            </label>
            <input
              type="text"
              value={enemyTeam}
              onChange={(e) => setEnemyTeam(e.target.value)}
              placeholder="e.g., Ahri, Aatrox, Yasuo"
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #cccccc',
                borderRadius: '4px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', color: '#ffffff' }}>
              Your Team (comma-separated):
            </label>
            <input
              type="text"
              value={allyTeam}
              onChange={(e) => setAllyTeam(e.target.value)}
              placeholder="e.g., Zed, Lee Sin"
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #cccccc',
                borderRadius: '4px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <button
            type="submit"
            disabled={teamLoading}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: teamLoading ? '#cccccc' : '#0066cc',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '16px',
              cursor: teamLoading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
          >
            {teamLoading ? 'Analyzing...' : 'Get Recommendations'}
          </button>
        </form>
        )}

        {activeTab === 'team' && teamError && (
          <div style={{
            padding: '10px',
            backgroundColor: '#ffcccc',
            border: '1px solid #ff0000',
            borderRadius: '4px',
            color: '#cc0000',
            marginBottom: '20px'
          }}>
            {teamError}
          </div>
        )}

        {activeTab === 'team' && teamResult && (
          <div style={{
            backgroundColor: '#f5f5f5',
            border: '1px solid #cccccc',
            borderRadius: '8px',
            padding: '20px'
          }}>
            <h2 style={{ fontSize: '18px', color: '#000000', margin: '0 0 15px 0' }}>
              Recommended Champions
            </h2>

            <div style={{ marginBottom: '15px', color: '#333333' }}>
              <strong>Enemy Team:</strong> {teamResult.enemy_team.map(formatChampionName).join(', ')}
            </div>

            <div style={{ marginBottom: '15px', color: '#333333' }}>
              <strong>Your Team:</strong> {teamResult.ally_team.map(formatChampionName).join(', ') || 'None'}
            </div>

            <div>
              <h3 style={{ fontSize: '16px', color: '#000000', margin: '0 0 10px 0' }}>
                Top Picks:
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {teamResult.recommendations.map((rec, index) => (
                  <div 
                    key={rec.champion}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #cccccc',
                      borderRadius: '6px',
                      padding: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '15px'
                    }}
                  >
                    <img
                      src={getChampionImageUrl(rec.champion)}
                      alt={rec.champion}
                      style={{
                        width: '50px',
                        height: '50px',
                        borderRadius: '4px',
                        border: '2px solid #0066cc'
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#ffffff' }}>
                        {index + 1}. {formatChampionName(rec.champion)}
                      </div>
                      <div style={{ fontSize: '12px', color: '#666666' }}>
                        Win Probability: <span style={{
                          color: rec.win_probability >= 50 ? '#006600' : '#cc0000',
                          fontWeight: 'bold'
                        }}>
                          {rec.win_probability}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'matchup' && result && showResults && (
          <div style={{
            backgroundColor: '#f5f5f5',
            border: '1px solid #cccccc',
            borderRadius: '8px',
            padding: '20px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h2 style={{ fontSize: '18px', color: '#000000', margin: '0' }}>
                Matchup Results
              </h2>
              <button
                onClick={handleBack}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#0066cc',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                ← Back
              </button>
            </div>
            
            {/* Champion VS Display */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '20px',
              marginBottom: '20px',
              padding: '15px',
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #cccccc'
            }}>
              <div style={{ textAlign: 'center' }}>
                <img
                  src={getChampionImageUrl(result.my_champion)}
                  alt={result.my_champion}
                  style={{
                    width: '80px',
                    height: '80px',
                    borderRadius: '8px',
                    border: '2px solid #0066cc'
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#000000', marginTop: '5px' }}>
                  {formatChampionName(result.my_champion)}
                </div>
              </div>

              <div style={{
                fontSize: '32px',
                fontWeight: '900',
                color: '#666666',
                fontStyle: 'italic'
              }}>
                VS
              </div>

              <div style={{ textAlign: 'center' }}>
                <img
                  src={getChampionImageUrl(result.enemy_champion)}
                  alt={result.enemy_champion}
                  style={{
                    width: '80px',
                    height: '80px',
                    borderRadius: '8px',
                    border: '2px solid #cc0000'
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#000000', marginTop: '5px' }}>
                  {formatChampionName(result.enemy_champion)}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <strong style={{ color: '#ffffff' }}>Win Rate:</strong>{' '}
              <span style={{
                color: result.predicted_winrate >= 50 ? '#006600' : '#cc0000',
                fontSize: '32px',
                fontWeight: 'bold'
              }}>
                {result.predicted_winrate}%
              </span>
            </div>

            <div style={{ marginBottom: '10px', color: '#cccccc' }}>
              <strong>Total Games:</strong> {result.total_games}
            </div>

            {result.recommended_items && result.recommended_items.length > 0 && (
              <div>
                <h3 style={{ fontSize: '16px', color: '#ffffff', margin: '0 0 10px 0' }}>
                  Recommended Items (When Winning):
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  {result.recommended_items.map((item) => (
                    <div 
                      key={item.item_id}
                      style={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #cccccc',
                        borderRadius: '6px',
                        padding: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        minWidth: '60px'
                      }}
                    >
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/item/${item.item_id}.png`}
                        alt={`Item ${item.item_id}`}
                        style={{
                          width: '40px',
                          height: '40px',
                          marginBottom: '5px'
                        }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <div style={{ fontSize: '11px', color: '#333333', textAlign: 'center' }}>
                        ID: {item.item_id}
                      </div>
                      <div style={{ fontSize: '10px', color: '#666666', textAlign: 'center' }}>
                        {item.build_rate}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </AppLayoutWrapper>
  );
}

export default App;
