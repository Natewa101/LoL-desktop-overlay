import WinRateCard from './WinRateCard';
import BuildPath from './BuildPath';
import Runes from './Runes';
import { MatchupAnalysis } from '../mockData';

interface AnalysisDashboardProps {
  analysis: MatchupAnalysis | null;
}

const AnalysisDashboard = ({ analysis }: AnalysisDashboardProps) => {
  if (!analysis) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-6xl mb-4">⚔️</div>
          <h2 className="text-2xl font-semibold text-zinc-400 mb-2">No Matchup Selected</h2>
          <p className="text-zinc-500">Enter your champion and enemy champion to analyze the matchup</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-zinc-100">Matchup Analysis</h2>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WinRateCard winRate={analysis.winRate} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BuildPath items={analysis.items} />
        <Runes runes={analysis.runes} />
      </div>
    </div>
  );
};

export default AnalysisDashboard;
