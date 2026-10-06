export interface Item {
  id: string;
  name: string;
  icon: string;
}

export interface Rune {
  id: string;
  name: string;
  tree: string;
  icon: string;
}

export interface MatchupAnalysis {
  winRate: number;
  items: Item[];
  runes: {
    primary: Rune[];
    secondary: Rune[];
  };
}

export const analyzeMatchup = (_myChamp: string, _enemyChamp: string): MatchupAnalysis => {
  // Mock function that returns hardcoded data
  // In production, this would call the ML backend
  
  return {
    winRate: 52.6,
    items: [
      { id: '1', name: 'Infinity Edge', icon: '' },
      { id: '2', name: 'Phantom Dancer', icon: '' },
      { id: '3', name: 'Bloodthirster', icon: '' },
      { id: '4', name: 'Berserker Greaves', icon: '' },
    ],
    runes: {
      primary: [
        { id: 'p1', name: 'Press the Attack', tree: 'Precision', icon: '' },
        { id: 'p2', name: 'Triumph', tree: 'Precision', icon: '' },
        { id: 'p3', name: 'Legend: Alacrity', tree: 'Precision', icon: '' },
        { id: 'p4', name: 'Coup de Grace', tree: 'Precision', icon: '' },
      ],
      secondary: [
        { id: 's1', name: 'Overheal', tree: 'Resolve', icon: '' },
        { id: 's2', name: 'Bone Plating', tree: 'Resolve', icon: '' },
      ],
    },
  };
};
