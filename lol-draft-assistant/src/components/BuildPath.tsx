import { Item } from '../mockData';

interface BuildPathProps {
  items: Item[];
}

const BuildPath = ({ items }: BuildPathProps) => {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
      <h3 className="text-lg font-semibold text-zinc-300 mb-4">Core Build</h3>
      <div className="flex flex-wrap gap-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex flex-col items-center bg-zinc-800 rounded-lg p-3 border border-zinc-700 hover:border-zinc-600 transition-colors"
          >
            <div className="text-3xl mb-2">{item.icon}</div>
            <div className="text-xs text-zinc-300 text-center font-medium">
              {item.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BuildPath;
