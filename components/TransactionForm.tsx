import React, { useState } from 'react';
import { TransactionType } from '../types';
import { PlusCircle } from 'lucide-react';

interface Props {
  onAdd: (transaction: any) => void;
  childId: string;
}

const TransactionForm: React.FC<Props> = ({ onAdd, childId }) => {
  const [amount, setAmount] = useState<string>('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [type, setType] = useState<TransactionType>(TransactionType.EXPENSE);
  const [category, setCategory] = useState('一般');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount))) return;

    onAdd({
      id: Date.now().toString(),
      childId,
      date,
      amount: Number(amount),
      description,
      type,
      category
    });

    setAmount('');
    setDescription('');
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 mb-6">
      <h3 className="text-lg font-black mb-6 flex items-center gap-2 text-slate-800">
        <PlusCircle className="text-blue-500 w-6 h-6" />
        記一筆新帳目
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:flex lg:flex-row lg:items-end gap-5">
        <div className="flex flex-col gap-2 min-w-[170px]">
          <label className="text-xs font-black text-slate-400 uppercase ml-1">收支日期</label>
          <input 
            type="date" 
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-blue-500 focus:outline-none font-bold text-slate-700"
          />
        </div>
        <div className="flex flex-col gap-2 min-w-[140px]">
          <label className="text-xs font-black text-slate-400 uppercase ml-1">交易類型</label>
          <select 
            value={type} 
            onChange={(e) => setType(e.target.value as TransactionType)}
            className="w-full border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-blue-500 focus:outline-none font-bold text-slate-700"
          >
            <option value={TransactionType.INCOME}>💰 收入</option>
            <option value={TransactionType.EXPENSE}>💸 支出</option>
          </select>
        </div>
        <div className="flex flex-col gap-2 min-w-[140px]">
          <label className="text-xs font-black text-slate-400 uppercase ml-1">金額</label>
          <input 
            type="number" 
            placeholder="0"
            value={amount}
            onChange={(e) => {
              const val = e.target.value;
              setAmount(val === '' ? '' : val);
            }}
            className="w-full border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-blue-500 focus:outline-none font-bold text-slate-700"
          />
        </div>
        <div className="flex flex-col gap-2 flex-grow min-w-0">
          <label className="text-xs font-black text-slate-400 uppercase ml-1">項目說明</label>
          <input 
            type="text" 
            placeholder="例如：壓歲錢"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border-2 border-slate-100 rounded-2xl p-3 bg-slate-50 focus:border-blue-500 focus:outline-none font-bold text-slate-700"
          />
        </div>
        <div className="min-w-[120px]">
          <button 
            type="submit"
            className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl hover:bg-blue-700 transition shadow-lg shadow-blue-100 active:scale-95"
          >
            記帳
          </button>
        </div>
      </div>
    </form>
  );
};

export default TransactionForm;