'use client';

import { useState, useEffect } from 'react';
import FileUploader from '../components/FileUploader';
import VideoCharts from '../components/VideoCharts';
import CreatorCard from '../components/CreatorCard';
import FollowerChart from '../components/FollowerChart';
import Papa from 'papaparse';
import { VideoData, ChartData, Creator, FollowerData, Video, Catagory, Detail, DetailData, DetailChartData } from '../types';
import jschardet from 'jschardet';
import VideoCard from '../components/VideoCard';
import CatagoryEditor from '../components/CatagoryEditor';
import DetailCard from '../components/DetailCard';
import DetailCharts from '../components/DetailCharts';

// 修改文件路径常量
const CREATORS_JSON_PATH = '/data/creators.json';  // creators.json 的新路径
const CREATOR_ASSETS_PATH = '/data/creators';      // UP主头像和CSV文件的路径
const VIDEOS_JSON_PATH = '/data/videos.json';
const VIDEO_ASSETS_PATH = '/data/videos';
const DETAILS_JSON_PATH = '/data/details.json';    // 动态数据的JSON文件路径
const DETAIL_ASSETS_PATH = '/data/detail';         // 动态数据的CSV文件路径

type TabType = 'video' | 'creator' | 'detail';

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>('video');
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [selectedCreator, setSelectedCreator] = useState<Creator | null>(null);
  const [followerData, setFollowerData] = useState<FollowerData[]>([]);
  const [isDebug, setIsDebug] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [isUploadVisible, setIsUploadVisible] = useState(false);
  const [isCatagoryEditorVisible, setIsCatagoryEditorVisible] = useState(false);
  const [catagories, setCatagories] = useState<Catagory[]>([]);
  const [selectedCatagory, setSelectedCatagory] = useState<string | null>(null);
  const [details, setDetails] = useState<Detail[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<Detail | null>(null);
  const [detailChartData, setDetailChartData] = useState<DetailChartData | null>(null);
  const [detailMetrics, setDetailMetrics] = useState<{ [key: string]: { likes: number; reposts: number; comments: number; } }>({});
  const [currentVideoPage, setCurrentVideoPage] = useState(1);
  const VIDEOS_PER_PAGE = 8;
  const [currentCreatorPage, setCurrentCreatorPage] = useState(1);
  const [currentDetailPage, setCurrentDetailPage] = useState(1);
  const CARDS_PER_PAGE = 8;

  const debug = (message: string, data?: any) => {
    if (isDebug) {
      if (data) {
        console.log(message, data);
      } else {
        console.log(message);
      }
    }
  };

  const debugError = (message: string, error?: any, context?: any) => {
    if (isDebug) {
      console.error('错误信息:', message);
      if (error) {
        console.error('错误数据:', error);
      }
      if (context) {
        console.error('上下文信息:', context);
      }
    }
  };

  // 加载UP主数据的函数提取出来，以便重用
  const loadCreators = async () => {
    try {
      const response = await fetch(CREATORS_JSON_PATH);
      const data = await response.json() as Creator[];
      
      // 为每个创作者加载最新的粉丝数据
      const updatedCreators = await Promise.all(data.map(async (creator) => {
        try {
          const csvResponse = await fetch(`${CREATOR_ASSETS_PATH}/${creator.mid}_follower.csv`);
          const csvText = await csvResponse.text();
          
          const parseResult = Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true
          });
          
          const followerData = parseResult.data as FollowerData[];
          // 获取去掉空行的有效数据
          const validFollowers = followerData.filter(row => Number(row.粉丝数) > 0).slice(-2);
          
          if (validFollowers.length > 0) {
            const latestData = validFollowers[validFollowers.length - 1];
            debug(`更新 ${creator.name} 的粉丝数: ${latestData.粉丝数}`);
            return {
              ...creator,
              followers: latestData.粉丝数,
              lastUpdate: latestData.时间
            };
          }
          return creator;
        } catch (error) {
          debugError(`加载 ${creator.name} 的粉丝数据失败:`, error);
          return creator;
        }
      }));

      // 更新 creators.json 文件
      try {
        const updateResponse = await fetch('/api/update-creators', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updatedCreators)
        });
        
        if (!updateResponse.ok) {
          throw new Error('更新 creators.json 失败');
        }
      } catch (error) {
        debugError('更新 creators.json 失败:', error);
      }

      setCreators(updatedCreators);
      
      // 如果没有选中的UP主，自动选择第一个
      if (!selectedCreator && updatedCreators.length > 0) {
        handleCreatorSelect(updatedCreators[0]);
      } 
      // 如果有选中的UP主，重新加载当前UP主的数据
      else if (selectedCreator) {
        const currentCreator = updatedCreators.find(c => c.mid === selectedCreator.mid);
        if (currentCreator) {
          handleCreatorSelect(currentCreator);
        }
      }
    } catch (error) {
      debugError('加载UP主数据失败:', error);
    }
  };

  // 加载视频数据
  const loadVideos = async () => {
    try {
      const response = await fetch(VIDEOS_JSON_PATH);
      const data = await response.json() as Video[];
      
      // 为每个视频加载最新的数据
      const updatedVideos = await Promise.all(data.map(async (video) => {
        try {
          const csvResponse = await fetch(`${VIDEO_ASSETS_PATH}/${video.bvid}_views.csv`);
          const csvText = await csvResponse.text();
          
          const parseResult = Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true
          });
          
          const viewsData = parseResult.data as VideoData[];
          // 获取去掉空行的有效数据
          const validViews = viewsData.filter(row => Number(row.播放量) > 0).slice(-2);
          
          if (validViews.length > 0) {
            const latestData = validViews[validViews.length - 1];
            return {
              ...video,
              views: Number(latestData.播放量),
              lastUpdate: latestData.时间
            };
          }
          return video;
        } catch (error) {
          debugError(`加载视频数据失败: ${video.bvid}`, error);
          return video;
        }
      }));

      setVideos(updatedVideos);
      
      // 如果没有选中的视频，自动选择第一个
      if (!selectedVideo && updatedVideos.length > 0) {
        handleVideoSelect(updatedVideos[0]);
      } else if (selectedVideo) {
        // 如果有选中的视频，重新加载当前视频的数据
        const currentVideo = updatedVideos.find(v => v.bvid === selectedVideo.bvid);
        if (currentVideo) {
          handleVideoSelect(currentVideo);
        }
      }
    } catch (error) {
      debugError('加载视频数据失败:', error);
    }
  };

  // 加载动态数据
  const loadDetails = async () => {
    try {
      const response = await fetch(DETAILS_JSON_PATH);
      const data = await response.json() as Detail[];
      
      // 为每个动态加载最新的数据
      const updatedDetails = await Promise.all(data.map(async (detail) => {
        try {
          const csvResponse = await fetch(`${DETAIL_ASSETS_PATH}/${detail.detail_id}_detailcount.csv`);
          const csvText = await csvResponse.text();
          
          const parseResult = Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true
          });
          
          const detailData = parseResult.data as DetailData[];
          // 获取最新的数据
          const latestData = detailData[detailData.length - 1];
          
          if (latestData) {
            setDetailMetrics(prev => ({
              ...prev,
              [detail.detail_id]: {
                likes: Number(latestData.点赞数),
                reposts: Number(latestData.转发数),
                comments: Number(latestData.评论数)
              }
            }));
          }
          return detail;
        } catch (error) {
          debugError(`加载动态数据失败: ${detail.detail_id}`, error);
          return detail;
        }
      }));

      setDetails(updatedDetails);
      
      // 如果没有选中的动态，自动选择第一个
      if (!selectedDetail && updatedDetails.length > 0) {
        handleDetailSelect(updatedDetails[0]);
      }
    } catch (error) {
      debugError('加载动态数据失败:', error);
    }
  };

  // 初始加载
  useEffect(() => {
    if (activeTab === 'video') {
      loadVideos();
    } else if (activeTab === 'creator') {
      loadCreators();
    } else if (activeTab === 'detail') {
      loadDetails();
    }
  }, [activeTab]);

  // 当切换到UP主标签时，如果没有选中的UP主，自动选择第一个
  useEffect(() => {
    if (activeTab === 'creator' && !selectedCreator && creators.length > 0) {
      handleCreatorSelect(creators[0]);
    }
  }, [activeTab, creators]);

  const handleCreatorSelect = async (creator: Creator) => {
    try {
      const response = await fetch(`${CREATOR_ASSETS_PATH}/${creator.mid}_follower.csv`);
      const text = await response.text();
      
      Papa.parse(text, {
        header: true,
        complete: (results) => {
          const data = results.data as FollowerData[];
          setFollowerData(data);
          setSelectedCreator(creator);
        },
        error: (error: Error) => {
          debugError('解析粉丝数据失败:', error);
        }
      });
    } catch (error) {
      debugError('加载粉丝数据失败:', error);
    }
  };

  const handleVideoSelect = async (video: Video) => {
    try {
      const response = await fetch(`${VIDEO_ASSETS_PATH}/${video.bvid}_views.csv`);
      const text = await response.text();
      
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          debug('解析结果:', results);
          // 过滤掉空行（所有字段都为空的行）
          const data = (results.data as VideoData[]).filter(row => 
            Object.values(row).some(value => value !== '')
          );
          
          if (data.length === 0) {
            debugError('没有数据被解析');
            return;
          }
          
          const processedData: ChartData = {
            xAxis: [],
            viewerData: [],
            playCountData: [],
            otherMetrics: {
              likes: [],
              coins: [],
              favorites: [],
              shares: [],
              danmaku: []
            }
          };

          data.forEach((row, index) => {
            if (!row.时间) {
              debugError('行数据格式错误', row, {
                lineNumber: index + 1,
                rawData: row,
                previousRow: index > 0 ? data[index - 1] : null,
                nextRow: index < data.length - 1 ? data[index + 1] : null
              });
              return;
            }
            
            const viewerCount = String(row.在线观看人数 || "0")
              .replace(/\+$/, '')
              .replace(/,/g, '');
            
            processedData.xAxis.push(row.时间);
            processedData.viewerData.push(Number(viewerCount) || 0);
            processedData.playCountData.push(Number(row.播放量) || 0);
            processedData.otherMetrics.likes.push(Number(row.点赞) || 0);
            processedData.otherMetrics.coins.push(Number(row.投币) || 0);
            processedData.otherMetrics.favorites.push(Number(row.收藏) || 0);
            processedData.otherMetrics.shares.push(Number(row.分享) || 0);
            processedData.otherMetrics.danmaku.push(Number(row.弹幕) || 0);
          });

          debug('处理后的数据:', processedData);
          setChartData(processedData);
          setSelectedVideo(video);
        },
        error: (error: Error) => {
          debugError('CSV解析错误:', error);
        }
      });
    } catch (error) {
      debugError('加载视频数据失败:', error);
    }
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        const uint8Array = new Uint8Array(buffer);
        
        // 将 Uint8Array 转换为字符串以进行编码检测
        const textForDetection = Array.from(uint8Array)
          .map(byte => String.fromCharCode(byte))
          .join('');
        const detected = jschardet.detect(textForDetection);
        debug('检测到的文件编码:', detected);

        // 使用检测到的编码进行解码
        const decoder = new TextDecoder(detected.encoding || 'utf-8');
        const content = decoder.decode(uint8Array);
        
        Papa.parse(content, {
          header: true,
          complete: (results) => {
            debug('解析结果:', results);
            // 过滤掉空行（所有字段都为空的行）
            const data = (results.data as VideoData[]).filter(row => 
              Object.values(row).some(value => value !== '')
            );
            
            if (data.length === 0) {
              debugError('没有数据被解析');
              return;
            }
            
            const processedData: ChartData = {
              xAxis: [],
              viewerData: [],
              playCountData: [],
              otherMetrics: {
                likes: [],
                coins: [],
                favorites: [],
                shares: [],
                danmaku: []
              }
            };

            data.forEach((row, index) => {
              if (!row.时间) {
                debugError('行数据格式错误', row, {
                  lineNumber: index + 1,
                  rawData: row,
                  previousRow: index > 0 ? data[index - 1] : null,
                  nextRow: index < data.length - 1 ? data[index + 1] : null
                });
                return;
              }
              
              const viewerCount = String(row.在线观看人数 || "0")
                .replace(/\+$/, '')
                .replace(/,/g, '');
              
              processedData.xAxis.push(row.时间);
              processedData.viewerData.push(Number(viewerCount) || 0);
              processedData.playCountData.push(Number(row.播放量) || 0);
              processedData.otherMetrics.likes.push(Number(row.点赞) || 0);
              processedData.otherMetrics.coins.push(Number(row.投币) || 0);
              processedData.otherMetrics.favorites.push(Number(row.收藏) || 0);
              processedData.otherMetrics.shares.push(Number(row.分享) || 0);
              processedData.otherMetrics.danmaku.push(Number(row.弹幕) || 0);
            });

            debug('处理后的数据:', processedData);
            setChartData(processedData);
          },
          error: (error: Error) => {
            debugError('CSV解析错误:', error);
          }
        });
      } catch (error) {
        debugError('文件读取或解析错误:', error);
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const handleVideoEdit = async (updatedVideo: Video) => {
    const updatedVideos = videos.map(video => video.bvid === updatedVideo.bvid ? updatedVideo : video);
    setVideos(updatedVideos);

    // 发送更新请求
    await fetch('/api/update-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedVideo),
    });
  };

  const handleCreatorEdit = async (updatedCreator: Creator) => {
    const updatedCreators = creators.map(creator => creator.mid === updatedCreator.mid ? updatedCreator : creator);
    setCreators(updatedCreators);

    // 发送更新请求
    await fetch('/api/update-creator', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedCreator),
    });
  };

  const loadCatagories = async () => {
    const path = '/data/catagory.json'; // 直接使用分类文件的路径
    const response = await fetch(path); // 直接使用根路径
    const data = await response.json();

    // 根据 activeTab 设置分类
    if (activeTab === 'video') {
        const videoCategories = [
            { name: "全部", order: 0 }, // 添加"全部"选项
            ...data.videoCategories
        ];
        setCatagories(videoCategories); // 设置视频分类
        setSelectedCatagory("全部"); // 默认选中"全部"
    } else if (activeTab === 'creator') {
        const creatorCategories = [
            { name: "全部", order: 0 }, // 添加"全部"选项
            ...data.creatorCategories
        ];
        setCatagories(creatorCategories); // 设置创作者分类
        setSelectedCatagory("全部"); // 默认选中"全部"
    } else if (activeTab === 'detail') {
        const detailCategories = [
            { name: "全部", order: 0 }, // 添加"全部"选项
            ...data.detailCategories
        ];
        setCatagories(detailCategories); // 设置动态分类
        setSelectedCatagory("全部"); // 默认选中"全部"
    }
  };

  const handleCatagorySave = async (updatedCatagories: Catagory[]) => {
    setCatagories(updatedCatagories);
    await fetch('/api/update-catagory', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedCatagories),
    });
  };

  // 处理分类切换
  const handleCatagoryChange = (catagory: string) => {
    setSelectedCatagory(catagory);
    setCurrentVideoPage(1);
    setCurrentCreatorPage(1);
    setCurrentDetailPage(1);
  };

  useEffect(() => {
    loadCatagories();
  }, [activeTab]); // 监听 activeTab 的变化

  const handleDetailSelect = async (detail: Detail) => {
    try {
      const response = await fetch(`${DETAIL_ASSETS_PATH}/${detail.detail_id}_detailcount.csv`);
      const text = await response.text();
      
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const data = results.data as DetailData[];
          
          const chartData: DetailChartData = {
            xAxis: [],
            metrics: {
              likes: [],
              reposts: [],
              comments: []
            }
          };

          data.forEach(row => {
            chartData.xAxis.push(row.时间);
            chartData.metrics.likes.push(Number(row.点赞数));
            chartData.metrics.reposts.push(Number(row.转发数));
            chartData.metrics.comments.push(Number(row.评论数));
          });

          setDetailChartData(chartData);
          setSelectedDetail(detail);
        },
        error: (error: Error) => {
          debugError('解析动态数据失败:', error);
        }
      });
    } catch (error) {
      debugError('加载动态数据失败:', error);
    }
  };

  // 计算分页后的视频
  const filteredVideos = videos.filter(video => selectedCatagory === "全部" || video.catagory === selectedCatagory);
  const totalVideoPages = Math.ceil(filteredVideos.length / VIDEOS_PER_PAGE);
  const pagedVideos = filteredVideos.slice((currentVideoPage - 1) * VIDEOS_PER_PAGE, currentVideoPage * VIDEOS_PER_PAGE);

  // 计算分页后的UP主
  const filteredCreators = creators.filter(creator => selectedCatagory === "全部" || creator.catagory === selectedCatagory);
  const totalCreatorPages = Math.ceil(filteredCreators.length / CARDS_PER_PAGE);
  const pagedCreators = filteredCreators.slice((currentCreatorPage - 1) * CARDS_PER_PAGE, currentCreatorPage * CARDS_PER_PAGE);

  // 计算分页后的动态
  const filteredDetails = details.filter(detail => selectedCatagory === "全部" || detail.catagory === selectedCatagory);
  const totalDetailPages = Math.ceil(filteredDetails.length / CARDS_PER_PAGE);
  const pagedDetails = filteredDetails.slice((currentDetailPage - 1) * CARDS_PER_PAGE, currentDetailPage * CARDS_PER_PAGE);

  return (
    <main className="container mx-auto p-4 min-h-screen">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">视频数据分析</h1>
        <button
          onClick={() => setIsDebug(!isDebug)}
          className={`px-4 py-2 rounded-md ${
            isDebug 
              ? 'bg-green-500 hover:bg-green-600' 
              : 'bg-gray-500 hover:bg-gray-600'
          } text-white transition-colors`}
        >
          调试模式: {isDebug ? '开' : '关'}
        </button>
      </div>

      <div className="mb-8">
        <div className="flex space-x-2 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('video')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'video'
                ? 'text-green-600 border-b-2 border-green-500'
                : 'text-gray-500 hover:text-green-500'
            }`}
          >
            视频数据
          </button>
          <button
            onClick={() => setActiveTab('creator')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'creator'
                ? 'text-green-600 border-b-2 border-green-500'
                : 'text-gray-500 hover:text-green-500'
            }`}
          >
            UP主粉丝量
          </button>
          <button
            onClick={() => setActiveTab('detail')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'detail'
                ? 'text-green-600 border-b-2 border-green-500'
                : 'text-gray-500 hover:text-green-500'
            }`}
          >
            动态数据
          </button>
        </div>
      </div>

      {/* 分类 Tab 切换 */}
      <div className="mb-4">
        <div className="flex space-x-4 border-b">
          {catagories.map((catagory) => (
            <button
              key={catagory.name}
              onClick={() => handleCatagoryChange(catagory.name)}
              className={`py-2 px-4 ${selectedCatagory === catagory.name ? 'border-b-2 border-blue-500 text-blue-500' : 'text-gray-500 hover:text-blue-500'}`}
            >
              {catagory.name}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'video' ? (
        <div className="space-y-8">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-800">视频列表</h2>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => loadVideos()}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md transition-colors flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>刷新数据</span>
              </button>
              <button
                onClick={() => setIsUploadVisible(!isUploadVisible)}
                className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-colors"
              >
                {isUploadVisible ? '收起' : '手动上传'}
              </button>
            </div>
          </div>
          
          <div className={`transition-all duration-300 ease-in-out ${
            isUploadVisible ? 'h-32 opacity-100' : 'h-0 opacity-0 overflow-hidden'
          }`}>
            <FileUploader onFileUpload={handleFileUpload} />
          </div>

          {/* 卡片列表：一行4个，分页 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {pagedVideos.map(video => (
              <VideoCard
                key={video.bvid}
                video={video}
                onClick={() => handleVideoSelect(video)}
                isSelected={selectedVideo?.bvid === video.bvid}
                onEdit={handleVideoEdit}
                catagories={catagories.map(cat => cat.name)}
              />
            ))}
          </div>

          {/* 分页按钮 */}
          {totalVideoPages > 1 && (
            <div className="flex justify-center items-center space-x-2 mt-4">
              <button
                onClick={() => setCurrentVideoPage(p => Math.max(1, p - 1))}
                disabled={currentVideoPage === 1}
                className={`px-3 py-1 rounded ${currentVideoPage === 1 ? 'bg-gray-200 text-gray-400' : 'bg-white border'}`}
              >上一页</button>
              {Array.from({ length: totalVideoPages }, (_, i) => (
                <button
                  key={i + 1}
                  onClick={() => setCurrentVideoPage(i + 1)}
                  className={`px-3 py-1 rounded ${currentVideoPage === i + 1 ? 'bg-green-500 text-white' : 'bg-white border'}`}
                >{i + 1}</button>
              ))}
              <button
                onClick={() => setCurrentVideoPage(p => Math.min(totalVideoPages, p + 1))}
                disabled={currentVideoPage === totalVideoPages}
                className={`px-3 py-1 rounded ${currentVideoPage === totalVideoPages ? 'bg-gray-200 text-gray-400' : 'bg-white border'}`}
              >下一页</button>
            </div>
          )}

          {selectedVideo && chartData && (
            <div className="mt-8">
              <VideoCharts data={chartData} />
            </div>
          )}
        </div>
      ) : activeTab === 'creator' ? (
        <div className="space-y-8">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-800">UP主列表</h2>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => loadCreators()}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md transition-colors flex items-center space-x-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>刷新数据</span>
              </button>
            </div>
          </div>
          {/* 卡片列表：一行4个，分页 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {pagedCreators.map(creator => (
              <CreatorCard
                key={creator.mid}
                creator={creator}
                onClick={() => handleCreatorSelect(creator)}
                isSelected={selectedCreator?.mid === creator.mid}
                onEdit={handleCreatorEdit}
                catagories={catagories.map(cat => cat.name)}
              />
            ))}
          </div>
          {/* 分页按钮 */}
          {totalCreatorPages > 1 && (
            <div className="flex justify-center items-center space-x-2 mt-4">
              <button
                onClick={() => setCurrentCreatorPage(p => Math.max(1, p - 1))}
                disabled={currentCreatorPage === 1}
                className={`px-3 py-1 rounded ${currentCreatorPage === 1 ? 'bg-gray-200 text-gray-400' : 'bg-white border'}`}
              >上一页</button>
              {Array.from({ length: totalCreatorPages }, (_, i) => (
                <button
                  key={i + 1}
                  onClick={() => setCurrentCreatorPage(i + 1)}
                  className={`px-3 py-1 rounded ${currentCreatorPage === i + 1 ? 'bg-green-500 text-white' : 'bg-white border'}`}
                >{i + 1}</button>
              ))}
              <button
                onClick={() => setCurrentCreatorPage(p => Math.min(totalCreatorPages, p + 1))}
                disabled={currentCreatorPage === totalCreatorPages}
                className={`px-3 py-1 rounded ${currentCreatorPage === totalCreatorPages ? 'bg-gray-200 text-gray-400' : 'bg-white border'}`}
              >下一页</button>
            </div>
          )}
          {selectedCreator && followerData.length > 0 && (
            <div className="mt-8">
              <FollowerChart
                data={followerData}
                creatorName={selectedCreator.name}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-800">动态列表</h2>
            <button
              onClick={() => loadDetails()}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md transition-colors flex items-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>刷新数据</span>
            </button>
          </div>
          {/* 卡片列表：一行4个，分页 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {pagedDetails.map(detail => (
              <DetailCard
                key={detail.detail_id}
                detail={detail}
                onClick={() => handleDetailSelect(detail)}
                isSelected={selectedDetail?.detail_id === detail.detail_id}
                metrics={detailMetrics[detail.detail_id]}
              />
            ))}
          </div>
          {/* 分页按钮 */}
          {totalDetailPages > 1 && (
            <div className="flex justify-center items-center space-x-2 mt-4">
              <button
                onClick={() => setCurrentDetailPage(p => Math.max(1, p - 1))}
                disabled={currentDetailPage === 1}
                className={`px-3 py-1 rounded ${currentDetailPage === 1 ? 'bg-gray-200 text-gray-400' : 'bg-white border'}`}
              >上一页</button>
              {Array.from({ length: totalDetailPages }, (_, i) => (
                <button
                  key={i + 1}
                  onClick={() => setCurrentDetailPage(i + 1)}
                  className={`px-3 py-1 rounded ${currentDetailPage === i + 1 ? 'bg-green-500 text-white' : 'bg-white border'}`}
                >{i + 1}</button>
              ))}
              <button
                onClick={() => setCurrentDetailPage(p => Math.min(totalDetailPages, p + 1))}
                disabled={currentDetailPage === totalDetailPages}
                className={`px-3 py-1 rounded ${currentDetailPage === totalDetailPages ? 'bg-gray-200 text-gray-400' : 'bg-white border'}`}
              >下一页</button>
            </div>
          )}
          {selectedDetail && detailChartData && (
            <div className="mt-8">
              <DetailCharts 
                data={detailChartData}
                title={selectedDetail.desc}
              />
            </div>
          )}
        </div>
      )}
      {isCatagoryEditorVisible && (
        <CatagoryEditor
          catagories={catagories}
          onSave={handleCatagorySave}
          onClose={() => setIsCatagoryEditorVisible(false)}
        />
      )}
    </main>
  );
} 