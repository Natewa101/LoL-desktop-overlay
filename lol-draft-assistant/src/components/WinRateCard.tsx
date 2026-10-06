interface WinRateCardProps {
  winRate: number;
}

const WinRateCard = ({ winRate }: WinRateCardProps) => {
  const isPositive = winRate >= 50;
  const colorClass = isPositive ? 'text-green-500' : 'text-red-500';
  const bgColorClass = isPositive ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30';

  return (
    <div className={`rounded-xl border p-6 ${bgColorClass}`}>
      <h3 className="text-lg font-semibold text-zinc-300 mb-4">Win Rate</h3>
      <div className="flex items-center justify-center">
        <span className={`text-6xl font-bold ${colorClass}`}>
          {winRate.toFixed(1)}%
        </span>
      </div>
      <p className="text-center text-zinc-400 mt-4 text-sm">
        {isPositive ? 'Favorable matchup' : 'Difficult matchup'}
      </p>
    </div>
  );
};

export default WinRateCard;
