import React, { useState } from 'react';

interface CatagoryEditorProps {
  catagories: { name: string; order: number }[];
  onSave: (updatedCatagories: { name: string; order: number }[]) => void;
  onClose: () => void;
}

const CatagoryEditor: React.FC<CatagoryEditorProps> = ({ catagories, onSave, onClose }) => {
  const [updatedCatagories, setUpdatedCatagories] = useState(catagories);

  const handleChange = (index: number, value: string) => {
    const newCatagories = [...updatedCatagories];
    newCatagories[index].name = value;
    setUpdatedCatagories(newCatagories);
  };

  const handleOrderChange = (index: number, value: number) => {
    const newCatagories = [...updatedCatagories];
    newCatagories[index].order = value;
    setUpdatedCatagories(newCatagories);
  };

  const handleSave = () => {
    onSave(updatedCatagories);
    onClose();
  };

  return (
    <div className="modal">
      <h2 className="text-lg font-bold">编辑分类排序</h2>
      <div className="space-y-4">
        {updatedCatagories.map((catagory, index) => (
          <div key={index} className="flex items-center space-x-2">
            <input
              type="text"
              value={catagory.name}
              onChange={(e) => handleChange(index, e.target.value)}
              className="border rounded p-1"
            />
            <input
              type="number"
              value={catagory.order}
              onChange={(e) => handleOrderChange(index, Number(e.target.value))}
              className="border rounded p-1 w-16"
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end space-x-2 mt-4">
        <button onClick={handleSave} className="bg-blue-500 text-white rounded px-4 py-2">保存</button>
        <button onClick={onClose} className="bg-gray-300 text-black rounded px-4 py-2">关闭</button>
      </div>
    </div>
  );
};

export default CatagoryEditor; 