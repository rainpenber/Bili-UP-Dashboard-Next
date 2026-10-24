import React from 'react';
import { Detail } from '../types';

interface DetailCardProps {
  detail: Detail;
  onClick: () => void;
  isSelected: boolean;
  metrics?: {
    likes: number;
    reposts: number;
    comments: number;
  };
}

const DetailCard: React.FC<DetailCardProps> = ({ detail, onClick, isSelected, metrics }) => {
  return (
    <div 
      onClick={onClick}
      className={`
        p-2 rounded-md shadow cursor-pointer transition-all
        hover:shadow-lg hover:scale-105
        ${isSelected ? 'bg-green-50 border-2 border-green-500' : 'bg-white border border-gray-200'}
        text-sm
      `}
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-gray-800 truncate" title={detail.desc}>
          {detail.desc.length > 12 ? `${detail.desc.slice(0, 12)}...` : detail.desc}
        </h3>
        {metrics && (
          <p className="text-xs text-gray-500">
            👍 {metrics.likes.toLocaleString()} · 
            🔄 {metrics.reposts.toLocaleString()} · 
            💬 {metrics.comments.toLocaleString()}
          </p>
        )}
        <p className="text-xs text-gray-400">
          分类: {detail.catagory}
        </p>
      </div>
    </div>
  );
};

export default DetailCard; 