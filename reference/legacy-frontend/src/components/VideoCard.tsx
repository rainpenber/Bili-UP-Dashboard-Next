import Image from 'next/image';
import { Video } from '../types';
import { useState, useEffect } from 'react';
import React from 'react';

// 引入变化数据
import changesViewRaw from '../../public/data/videos/changes_view.json';

// 定义变化数据的类型
interface ChangesView {
  更新时间: string;
  [key: string]: string;
}

// 将原始数据断言为 ChangesView 类型
const changesView = changesViewRaw as ChangesView;

interface VideoCardProps {
  video: Video;
  onClick: () => void;
  isSelected: boolean;
  onEdit: (video: Video) => void;
  catagories: string[];
}

const VideoCard: React.FC<VideoCardProps> = ({ video, onClick, isSelected, onEdit, catagories }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [catagory, setCatagory] = useState(video.catagory);

  const getChangeText = (info: string) => {
    if (info.includes('_')) {
      const [timeFrame, changeType] = info.split('_');
      switch (changeType) {
        case 'Rising':
          return `一天内快速增长🔥`;
        case 'Falling':
          return `一天内快速下降⚠️`;
        default:
          return '';
      }
    } else {
      switch (info) {
        case 'climbing':
          return '自然增长↗️';
        case 'Sliding':
          return '缓慢下降↘️';
        case 'No Change':
          return '无变化';
        default:
          return '';
      }
    }
  };

  const changeInfo = (changesView as { [key: string]: string })[video.bvid];
  const changeText = changeInfo ? getChangeText(changeInfo) : '';

  const handleSave = async () => {
    await fetch('/api/update-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...video, catagory }),
    });
    setIsEditing(false);
  };

  // 格式化播放量
  const formatViews = (count: number | string) => {
    const num = Number(count);
    const wan = num / 10000;
    const formatted = num.toLocaleString();
    
    if (wan >= 1) {
      return `${wan.toFixed(1)}万（${formatted}）`;
    }
    return formatted;
  };

  const getPreviousViews = () => {
    const videoKeys = Object.keys(changesView);
    const index = videoKeys.indexOf(video.bvid);
    if (index > 0) {
      return changesView[videoKeys[index - 1]];
    }
    return null;
  };

  // 获取去掉空行的有效数据
  const validViews = Object.entries(changesView)
    .filter(([key, value]) => value !== '0' && value !== 'No Change')
    .slice(-2);

  // 处理播放量为0的情况
  const currentViews = video.views === 0 && validViews.length > 1 ? validViews[validViews.length - 2][1] : video.views;

  // console.log(`当前播放量: ${video.views}`);
  // console.log(`获取的上一条播放量数据: ${getPreviousViews()}`);
  // console.log(`最终使用的播放量: ${currentViews}`);

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
      <div className="space-y-2">
        <div className="relative w-full aspect-[16/9] rounded-md overflow-hidden" style={{ minHeight: 0, height: 0, paddingBottom: '56.25%' }}>
          <Image
            src={video.cover}
            alt={video.title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 25vw"
            style={{ objectFit: 'cover' }}
          />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-800 truncate" title={video.title}>
            {video.title.length > 10 ? `${video.title.slice(0, 10)}...` : video.title}
          </h3>
          <p className="text-green-600 font-medium text-xs">
            {formatViews(currentViews)} 播放
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
          {video.lastUpdate && (
            <p className="text-xs text-gray-500">
              更新于：{video.lastUpdate}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoCard;