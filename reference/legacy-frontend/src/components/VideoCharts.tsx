import React, { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { ChartData } from '../types';

interface VideoChartsProps {
  data: ChartData;
}

const VideoCharts: React.FC<VideoChartsProps> = ({ data }) => {
  const [viewershipZoomed, setViewershipZoomed] = useState(false);
  const [metricsZoomed, setMetricsZoomed] = useState(false);

  // 数据抽样函数
  const sampleData = (data: any[], threshold = 1000) => {
    if (data.length <= threshold) return data;
    const sampleInterval = Math.ceil(data.length / threshold);
    return data.filter((_, index) => index % sampleInterval === 0);
  };

  // 处理数据
  const { processedData, timeRange } = useMemo(() => {
    if (!data || !data.xAxis || data.xAxis.length === 0) {
      return {
        processedData: {
          xAxis: [],
          viewerData: [] as number[],
          playCountData: [] as number[],
          otherMetrics: {
            likes: [] as number[],
            coins: [] as number[],
            favorites: [] as number[],
            shares: [] as number[],
            danmaku: [] as number[]
          }
        },
        timeRange: { min: 0, max: 0 }
      };
    }

    // 对时间轴进行抽样，获取采样索引
    const sampledIndices = Array.from(
      { length: data.xAxis.length },
      (_, i) => i
    ).filter((_, index) => index % Math.ceil(data.xAxis.length / 1000) === 0);

    // 根据采样索引处理所有数据
    const processedData = {
      xAxis: sampledIndices.map(i => data.xAxis[i]),
      viewerData: [] as number[],
      playCountData: [] as number[],
      otherMetrics: {
        likes: [] as number[],
        coins: [] as number[],
        favorites: [] as number[],
        shares: [] as number[],
        danmaku: [] as number[]
      }
    };

    // 处理数据，对0值进行处理
    sampledIndices.forEach((currentIndex, arrayIndex) => {
      // 获取上一个有效数据点的索引
      const prevIndex = arrayIndex > 0 ? sampledIndices[arrayIndex - 1] : -1;

      // 处理观看人数
      const viewerCount = Number(data.viewerData[currentIndex]) || 0;
      processedData.viewerData.push(
        viewerCount === 0 && prevIndex >= 0 ? processedData.viewerData[arrayIndex - 1] : viewerCount
      );

      // 处理播放量
      const playCount = Number(data.playCountData[currentIndex]) || 0;
      processedData.playCountData.push(
        playCount === 0 && prevIndex >= 0 ? processedData.playCountData[arrayIndex - 1] : playCount
      );

      // 处理其他指标
      const metrics = ['likes', 'coins', 'favorites', 'shares', 'danmaku'] as const;
      metrics.forEach(metric => {
        const value = Number(data.otherMetrics[metric][currentIndex]) || 0;
        processedData.otherMetrics[metric].push(
          value === 0 && prevIndex >= 0 ? processedData.otherMetrics[metric][arrayIndex - 1] : value
        );
      });
    });

    // 计算时间范围
    const times = processedData.xAxis.map(time => new Date(time).getTime());
    const timeRange = {
      min: Math.min(...times),
      max: Math.max(...times)
    };

    return { processedData, timeRange };
  }, [data]);

  const viewershipOption = {
    title: {
      text: '播放数据趋势',
      left: 'center',
      subtext: viewershipZoomed ? '已缩放' : '',
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        if (!params || params.length === 0) return '';
        
        const time = new Date(params[0].value[0]).toLocaleString('zh-CN');
        let result = `${time}<br/>`;
        
        params.forEach((param: any) => {
          if (param.seriesName === '总播放量(千次)') {
            const actualValue = param.value[1] * 1000;
            result += `${param.marker} ${param.seriesName}：${param.value[1].toFixed(1)}（${actualValue.toLocaleString()}）<br/>`;
          } else {
            result += `${param.marker} ${param.seriesName}：${param.value[1].toLocaleString()}<br/>`;
          }
        });
        
        return result;
      }
    },
    legend: {
      data: ['在线观看人数', '总播放量(千次)'],
      top: 30
    },
    toolbox: {
      feature: {
        dataZoom: {
          yAxisIndex: 'none'
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
        start: 0,
        end: 100,
        onZoom: () => setViewershipZoomed(true)
      },
      {
        type: 'slider',
        start: 0,
        end: 100
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
    yAxis: [
      {
        type: 'value',
        name: '在线观看人数'
      },
      {
        type: 'value',
        name: '播放量(千次)'
      }
    ],
    series: [
      {
        name: '在线观看人数',
        type: 'line',
        data: processedData.xAxis.map((time, index) => [
          new Date(time).getTime(),
          processedData.viewerData[index]
        ]),
        showSymbol: false,
        symbolSize: 4,
        emphasis: {
          scale: true,
          focus: 'series',
          itemStyle: {
            symbolSize: 8
          }
        },
        sampling: 'lttb',
        progressive: 500,
        progressiveThreshold: 3000,
        animation: true
      },
      {
        name: '总播放量(千次)',
        type: 'line',
        yAxisIndex: 1,
        data: processedData.xAxis.map((time, index) => [
          new Date(time).getTime(),
          processedData.playCountData[index] / 1000
        ]),
        showSymbol: false,
        symbolSize: 4,
        emphasis: {
          scale: true,
          focus: 'series',
          itemStyle: {
            symbolSize: 6
          }
        },
        sampling: 'lttb',
        progressive: 500,
        progressiveThreshold: 3000,
        animation: true
      }
    ]
  };

  const metricsOption = {
    title: {
      text: '互动数据趋势',
      left: 'center',
      subtext: metricsZoomed ? '已缩放' : '',
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        if (!params || params.length === 0) return '';
        
        const time = new Date(params[0].value[0]).toLocaleString('zh-CN');
        let result = `${time}<br/>`;
        
        params.forEach((param: any) => {
          result += `${param.marker} ${param.seriesName}：${param.value[1].toLocaleString()}<br/>`;
        });
        
        return result;
      }
    },
    legend: {
      data: ['点赞', '投币', '收藏', '分享', '弹幕'],
      top: 30
    },
    toolbox: {
      feature: {
        dataZoom: {
          yAxisIndex: 'none'
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
        start: 0,
        end: 100,
        onZoom: () => setMetricsZoomed(true)
      },
      {
        type: 'slider',
        start: 0,
        end: 100
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
      type: 'value'
    },
    series: [
      {
        name: '点赞',
        type: 'line',
        data: processedData.xAxis.map((time, index) => [
          new Date(time).getTime(),
          processedData.otherMetrics.likes[index]
        ]),
        showSymbol: false,
        symbolSize: 4,
        emphasis: {
          scale: true,
          focus: 'series',
          itemStyle: {
            symbolSize: 6
          }
        },
        sampling: 'lttb',
        progressive: 500,
        progressiveThreshold: 3000,
        animation: true
      },
      {
        name: '投币',
        type: 'line',
        data: processedData.xAxis.map((time, index) => [
          new Date(time).getTime(),
          processedData.otherMetrics.coins[index]
        ]),
        showSymbol: false,
        symbolSize: 4,
        emphasis: {
          scale: true,
          focus: 'series',
          itemStyle: {
            symbolSize: 6
          }
        },
        sampling: 'lttb',
        progressive: 500,
        progressiveThreshold: 3000,
        animation: true
      },
      {
        name: '收藏',
        type: 'line',
        data: processedData.xAxis.map((time, index) => [
          new Date(time).getTime(),
          processedData.otherMetrics.favorites[index]
        ]),
        showSymbol: false,
        symbolSize: 4,
        emphasis: {
          scale: true,
          focus: 'series',
          itemStyle: {
            symbolSize: 6
          }
        },
        sampling: 'lttb',
        progressive: 500,
        progressiveThreshold: 3000,
        animation: true
      },
      {
        name: '分享',
        type: 'line',
        data: processedData.xAxis.map((time, index) => [
          new Date(time).getTime(),
          processedData.otherMetrics.shares[index]
        ]),
        showSymbol: false,
        symbolSize: 4,
        emphasis: {
          scale: true,
          focus: 'series',
          itemStyle: {
            symbolSize: 6
          }
        },
        sampling: 'lttb',
        progressive: 500,
        progressiveThreshold: 3000,
        animation: true
      },
      {
        name: '弹幕',
        type: 'line',
        data: processedData.xAxis.map((time, index) => [
          new Date(time).getTime(),
          processedData.otherMetrics.danmaku[index]
        ]),
        showSymbol: false,
        symbolSize: 4,
        emphasis: {
          scale: true,
          focus: 'series',
          itemStyle: {
            symbolSize: 6
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
    <div className="space-y-8">
      <ReactECharts 
        option={viewershipOption} 
        style={{ height: '400px' }}
        onEvents={{
          restore: () => setViewershipZoomed(false)
        }}
      />
      <ReactECharts 
        option={metricsOption} 
        style={{ height: '400px' }}
        onEvents={{
          restore: () => setMetricsZoomed(false)
        }}
      />
    </div>
  );
};

export default VideoCharts; 