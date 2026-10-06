import { Rune } from '../mockData';

interface RunesProps {
  runes: {
    primary: Rune[];
    secondary: Rune[];
  };
}

const Runes = ({ runes }: RunesProps) => {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
      <h3 className="text-lg font-semibold text-zinc-300 mb-4">Runes</h3>
      
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-medium text-zinc-400 mb-3">Primary Tree</h4>
          <div className="flex flex-wrap gap-2">
            {runes.primary.map((rune) => (
              <div
                key={rune.id}
                className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2 border border-zinc-700"
              >
                <span className="text-xl">{rune.icon}</span>
                <div>
                  <div className="text-xs text-zinc-300 font-medium">{rune.name}</div>
                  <div className="text-xs text-zinc-500">{rune.tree}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-400 mb-3">Secondary Tree</h4>
          <div className="flex flex-wrap gap-2">
            {runes.secondary.map((rune) => (
              <div
                key={rune.id}
                className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2 border border-zinc-700"
              >
                <span className="text-xl">{rune.icon}</span>
                <div>
                  <div className="text-xs text-zinc-300 font-medium">{rune.name}</div>
                  <div className="text-xs text-zinc-500">{rune.tree}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Runes;
