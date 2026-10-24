import React, { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { FollowerData } from '../types';

interface FollowerChartProps {
  data: FollowerData[];
  creatorName: string;
}

const FollowerChart: React.FC<FollowerChartProps> = ({ data, creatorName }) => {
  const [isZoomed, setIsZoomed] = useState(false);

  // 数据抽样函数：根据数据量自动调整采样率
  const sampleData = (data: FollowerData[]) => {
    const threshold = 1000; // 超过这个数量就开始采样
    if (data.length <= threshold) return data;
    
    const sampleInterval = Math.ceil(data.length / threshold);
    return data.filter((_, index) => index % sampleInterval === 0);
  };

  // 计算合适的显示区间
  const { yAxisMin, yAxisMax, defaultZoomStart, defaultZoomEnd, timeRange, sampledData } = useMemo(() => {
    // 数据抽样
    const sampledData = sampleData(data);

    if (sampledData.length === 0) {
      return { 
        yAxisMin: 0, 
        yAxisMax: 100, 
        defaultZoomStart: 0, 
        defaultZoomEnd: 100,
        timeRange: { min: 0, max: 0 },
        sampledData: []
      };
    }

    // 处理0值数据
    const processedData = sampledData.map((item, index) => {
      if (index === 0) return item;
      const followerCount = Number(item.粉丝数) || 0;
      if (followerCount === 0) {
        return {
          ...item,
          粉丝数: sampledData[index - 1].粉丝数
        };
      }
      return item;
    });

    // 计算粉丝数范围
    const followers = processedData.map(item => Number(item.粉丝数));
    const validFollowers = followers.filter(num => !isNaN(num));
    
    if (validFollowers.length === 0) {
      return { 
        yAxisMin: 0, 
        yAxisMax: 100, 
        defaultZoomStart: 0, 
        defaultZoomEnd: 100,
        timeRange: { min: 0, max: 0 },
        sampledData: []
      };
    }

    const min = Math.min(...validFollowers);
    const max = Math.max(...validFollowers);

    // 计算时间范围
    const times = processedData.map(item => {
      const timeStr = item.时间;
      if (timeStr.includes('T') && timeStr.includes('Z')) {
        return new Date(timeStr).getTime();
      } else if (timeStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        return new Date(timeStr.replace(' ', 'T')).getTime();
      } else {
        const parts = timeStr.split(/[- :]/);
        if (parts.length >= 6) {
          const [year, month, day, hour, minute, second] = parts;
          return new Date(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute),
            Number(second)
          ).getTime();
        }
        return new Date(timeStr).getTime();
      }
    });

    const validTimes = times.filter(t => !isNaN(t) && t > 0);
    const timeMin = Math.min(...validTimes);
    const timeMax = Math.max(...validTimes);

    // 计算3个月前的时间戳
    const threeMonthsAgo = new Date(timeMax);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 2);
    
    // 计算默认显示范围的百分比
    const totalRange = timeMax - timeMin;
    const defaultStart = Math.max(0, (threeMonthsAgo.getTime() - timeMin) / totalRange * 100);
    const defaultEnd = 100;

    return {
      yAxisMin: Math.max(0, min * 0.95, min - 300),
      yAxisMax: Math.min(max * 1.05, max + 300),
      defaultZoomStart: defaultStart,
      defaultZoomEnd: defaultEnd,
      timeRange: { 
        min: timeMin || Date.now() - 24 * 60 * 60 * 1000,
        max: timeMax || Date.now()
      },
      sampledData: processedData
    };
  }, [data]);

  // 格式化粉丝数的函数
  const formatFollowers = (count: number | undefined) => {
    if (count === undefined || isNaN(count)) return '0';
    const wan = count / 10000;
    const formatted = count.toLocaleString();
    return wan >= 1 ? `${wan.toFixed(1)}万（${formatted}）` : formatted;
  };

  // 准备图表数据
  const seriesData = useMemo(() => {
    return sampledData.map(item => {
      let timestamp: number;
      const timeStr = item.时间;
      
      if (timeStr.includes('T') && timeStr.includes('Z')) {
        timestamp = new Date(timeStr).getTime();
      } else if (timeStr.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        timestamp = new Date(timeStr.replace(' ', 'T')).getTime();
      } else {
        const parts = timeStr.split(/[- :]/);
        if (parts.length >= 6) {
          const [year, month, day, hour, minute, second] = parts;
          timestamp = new Date(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute),
            Number(second)
          ).getTime();
        } else {
          timestamp = new Date(timeStr).getTime();
        }
      }
      
      return [timestamp, Number(item.粉丝数)];
    }).filter(([timestamp, value]) => !isNaN(timestamp) && !isNaN(value) && timestamp > 0);
  }, [sampledData]);

  const option = {
    title: {
      text: `${creatorName} 粉丝变化趋势`,
      left: 'center',
      subtext: isZoomed ? '已缩放' : '',
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        if (!params || params.length === 0) return '';
        const dataPoint = params[0];
        const value = dataPoint.value[1];
        const time = new Date(dataPoint.value[0]).toLocaleString('zh-CN');
        return `${time}<br/>粉丝数：${formatFollowers(value)}`;
      }
    },
    toolbox: {
      feature: {
        dataZoom: {
          yAxisIndex: [0],
          title: {
            zoom: '区域缩放',
            back: '还原'
          }
        },
        restore: {
          show: true,
          title: '复原'
        }
      },
      right: 10,
      top: 0
    },
    dataZoom: [
      {
        type: 'inside',
        start: defaultZoomStart,
        end: defaultZoomEnd,
        onZoom: () => setIsZoomed(true)
      },
      {
        type: 'slider',
        start: defaultZoomStart,
        end: defaultZoomEnd
      },
      {
        type: 'slider',
        yAxisIndex: [0],
        right: '10%',
        orient: 'vertical',
        zoomOnMouseWheel: true,
        moveOnMouseMove: true
      }
    ],
    xAxis: {
      type: 'time',
      min: timeRange.min,
      max: timeRange.max,
      axisLabel: {
        formatter: (value: number) => {
          const date = new Date(value);
          return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
        }
      }
    },
    yAxis: {
      type: 'value',
      name: '粉丝数',
      min: yAxisMin,
      max: yAxisMax,
      scale: true,
      axisLabel: {
        formatter: (value: number) => formatFollowers(value)
      }
    },
    series: [
      {
        name: '粉丝数',
        type: 'line',
        data: seriesData,
        smooth: true,
        lineStyle: {
          color: '#10B981'
        },
        showSymbol: false,
        symbolSize: 4,
        emphasis: {
          scale: true,
          focus: 'series',
          itemStyle: {
            symbolSize: 8
          }
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [{
              offset: 0,
              color: 'rgba(16, 185, 129, 0.3)'
            }, {
              offset: 1,
              color: 'rgba(16, 185, 129, 0.05)'
            }]
          }
        },
        sampling: 'lttb',
        progressive: 500,
        progressiveThreshold: 3000,
        animation: true
      }
    ]
  };

  return (
    <ReactECharts
      option={option}
      style={{ height: '400px' }}
      onEvents={{
        restore: () => {
          setIsZoomed(false);
        }
      }}
    />
  );
};

export default FollowerChart; 