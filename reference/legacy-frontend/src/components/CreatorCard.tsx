import React from 'react';
import Image from 'next/image';
import { Creator } from '../types';
import { useState } from 'react';

// 定义变化数据的类型
interface ChangesFollower {
  更新时间: string;
  [key: string]: string;
}

// 引入变化数据
import changesFollowerRaw from '../../public/data/creators/changes_follower.json';

// 将原始数据断言为 ChangesFollower 类型
const changesFollower = changesFollowerRaw as ChangesFollower;

interface CreatorCardProps {
  creator: Creator;
  onClick: () => void;
  isSelected: boolean;
  onEdit: (creator: Creator) => void;
  catagories: string[];
}

const CreatorCard: React.FC<CreatorCardProps> = ({ creator, onClick, isSelected, onEdit, catagories }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [catagory, setCatagory] = useState(creator.catagory);

  const getChangeText = (info: string) => {
    if (info.includes('_')) {
      const [timeFrame, changeType] = info.split('_');
      switch (changeType) {
        case 'Rising':
          return `一天内快速涨粉🔥`;
        case 'Falling':
          return `一天内快速掉粉⚠️`;
        default:
          return '';
      }
    } else {
      switch (info) {
        case 'climbing':
          return '自然涨粉↗️';
        case 'Sliding':
          return '自然掉粉↘️';
        case 'No Change':
          return '无变化';
        default:
          return '';
      }
    }
  };

  const changeInfo = (changesFollower as ChangesFollower)[creator.mid];
  const changeText = changeInfo ? getChangeText(changeInfo) : '';

  const handleSave = async () => {
    await fetch('/api/update-creator', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...creator, catagory }),
    });
    setIsEditing(false);
  };

  // 格式化粉丝数
  const formatFollowers = (count: number | string) => {
    const num = Number(count);
    const wan = num / 10000;
    const formatted = num.toLocaleString(); // 添加千位分隔符
    
    if (wan >= 1) {
      return `${wan.toFixed(1)}万（${formatted}）`;
    }
    return formatted;
  };

  const getPreviousFollowers = () => {
    const creatorKeys = Object.keys(changesFollower);
    const index = creatorKeys.indexOf(creator.mid);
    if (index > 0) {
      return changesFollower[creatorKeys[index - 1]];
    }
    return null;
  };

  // 获取去掉空行的有效数据
  const validFollowers = Object.entries(changesFollower)
    .filter(([key, value]) => value !== '0' && value !== 'No Change')
    .slice(-2);

  // 处理粉丝数为0的情况
  const currentFollowers = creator.followers === 0 && validFollowers.length > 1 ? validFollowers[validFollowers.length - 2][1] : creator.followers;

  // console.log(`当前粉丝数: ${creator.followers}`);
  // console.log(`获取的上一条粉丝数据: ${getPreviousFollowers()}`);
  // console.log(`最终使用的粉丝数: ${currentFollowers}`);

  return (
    <div 
      onClick={onClick}
      className={
        `
          p-2 rounded-md shadow cursor-pointer transition-all
          hover:shadow-lg hover:scale-105
          ${isSelected ? 'bg-green-50 border-2 border-green-500' : 'bg-white border border-gray-200'}
          text-sm
        `
      }
    >
      <div className="flex items-center space-x-2">
        <div className="relative w-10 h-10">
          <Image
            src={creator.avatar}
            alt={creator.name}
            width={40}
            height={40}
            className="rounded-full object-cover"
          />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-gray-800 truncate" title={creator.name}>{creator.name.length > 8 ? `${creator.name.slice(0, 8)}...` : creator.name}</h3>
          <p className="text-green-600 font-medium text-xs">
            {formatFollowers(currentFollowers)} 粉丝
            {changeText && <span className={`text-xs ${changeText.includes('快速') ? 'text-red-500' : 'text-gray-400'} ml-1`}>{changeText}</span>}
          </p>
          <p className="text-gray-600 text-xs">
            分类: 
            {isEditing ? (
              <select 
                value={catagory} 
                onChange={(e) => setCatagory(e.target.value)} 
                className="ml-1 border rounded p-0.5"
              >
                {catagories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            ) : (
              <span>{catagory}</span>
            )}
            <button onClick={(e) => { e.stopPropagation(); setIsEditing(!isEditing); }} className="ml-1 text-gray-500 text-xs">修改分类</button>
          </p>
          {isEditing && (
            <button onClick={handleSave} className="text-xs text-blue-500">保存</button>
          )}
          {creator.lastUpdate && (
            <p className="text-xs text-gray-500">
              更新于：{creator.lastUpdate}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreatorCard; 