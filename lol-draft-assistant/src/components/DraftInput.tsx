import { useState } from 'react';

interface DraftInputProps {
  onCalculate: (myChamp: string, enemyChamp: string) => void;
}

const DraftInput = ({ onCalculate }: DraftInputProps) => {
  const [role, setRole] = useState<string>('');
  const [myChampion, setMyChampion] = useState<string>('');
  const [enemyChampion, setEnemyChampion] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (myChampion && enemyChampion) {
      onCalculate(myChampion, enemyChampion);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="role" className="block text-sm font-medium text-zinc-400 mb-2">
          My Role
        </label>
        <select
          id="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-600 focus:border-transparent"
        >
          <option value="">Select Role</option>
          <option value="top">Top</option>
          <option value="jungle">Jungle</option>
          <option value="mid">Mid</option>
          <option value="adc">ADC</option>
          <option value="support">Support</option>
        </select>
      </div>

      <div>
        <label htmlFor="myChampion" className="block text-sm font-medium text-zinc-400 mb-2">
          My Champion
        </label>
        <input
          type="text"
          id="myChampion"
          value={myChampion}
          onChange={(e) => setMyChampion(e.target.value)}
          placeholder="Enter champion name"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600 focus:border-transparent"
        />
      </div>

      <div>
        <label htmlFor="enemyChampion" className="block text-sm font-medium text-zinc-400 mb-2">
          Enemy Champion
        </label>
        <input
          type="text"
          id="enemyChampion"
          value={enemyChampion}
          onChange={(e) => setEnemyChampion(e.target.value)}
          placeholder="Enter enemy champion"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600 focus:border-transparent"
        />
      </div>

      <button
        type="submit"
        className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-semibold py-2.5 px-4 rounded-lg transition-colors duration-200"
      >
        Calculate Matchup
      </button>
    </form>
  );
};

export default DraftInput;
