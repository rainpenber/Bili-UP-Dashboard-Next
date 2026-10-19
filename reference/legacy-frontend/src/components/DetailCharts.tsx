import React, { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { DetailChartData } from '../types';

interface DetailChartsProps {
  data: DetailChartData;
  title: string;
}

const DetailCharts: React.FC<DetailChartsProps> = ({ data, title }) => {
  const [isZoomed, setIsZoomed] = useState(false);

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
          metrics: {
            likes: [],
            reposts: [],
            comments: []
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
      metrics: {
        likes: sampledIndices.map(i => data.metrics.likes[i]),
        reposts: sampledIndices.map(i => data.metrics.reposts[i]),
        comments: sampledIndices.map(i => data.metrics.comments[i])
      }
    };

    // 计算时间范围
    const times = processedData.xAxis.map(time => new Date(time).getTime());
    const timeRange = {
      min: Math.min(...times),
      max: Math.max(...times)
    };

    return { processedData, timeRange };
  }, [data]);

  const option = {
    title: {
      text: `${title} - 互动数据趋势`,
      left: 'center',
      subtext: isZoomed ? '已缩放' : '',
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        if (!params || params.length === 0) return '';
        
        const time = new Date(params[0].value[0]).toLocaleString('zh-CN');
        let result = `${time}<br/>`;
        
        params.forEach((param: any) => {
          result += `${param.marker} ${param.seriesName}：${param.value[1]}<br/>`;
        });
        
        return result;
      }
    },
    legend: {
      data: ['点赞', '转发', '评论'],
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
        onZoom: () => setIsZoomed(true)
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
          processedData.metrics.likes[index]
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
        name: '转发',
        type: 'line',
        data: processedData.xAxis.map((time, index) => [
          new Date(time).getTime(),
          processedData.metrics.reposts[index]
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
        name: '评论',
        type: 'line',
        data: processedData.xAxis.map((time, index) => [
          new Date(time).getTime(),
          processedData.metrics.comments[index]
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
      }
    ]
  };

  return (
    <ReactECharts 
      option={option} 
      style={{ height: '400px' }}
      onEvents={{
        restore: () => setIsZoomed(false)
      }}
    />
  );
};

export default DetailCharts; 