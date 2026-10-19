export interface VideoData {
  时间: string;
  播放量: number;
  在线观看人数: number;
  点赞: number;
  投币: number;
  收藏: number;
  分享: number;
  弹幕: number;
}

export interface ChartData {
  xAxis: string[];
  viewerData: number[];
  playCountData: number[];
  otherMetrics: {
    likes: number[];
    coins: number[];
    favorites: number[];
    shares: number[];
    danmaku: number[];
  };
}

export interface Creator {
  mid: string;
  name: string;
  avatar: string;
  followers: number;
  lastUpdate?: string;
  catagory: string;
}

export interface FollowerData {
  时间: string;
  粉丝数: number;
}

export interface Video {
  bvid: string;
  title: string;
  cover: string;
  views: number;
  lastUpdate?: string;
  catagory: string;
}

export interface Catagory {
  name: string;
  order: number;
}

export interface Detail {
  detail_id: string;
  desc: string;
  catagory: string;
}

export interface DetailData {
  时间: string;
  点赞数: number;
  转发数: number;
  评论数: number;
}

export interface DetailChartData {
  xAxis: string[];
  metrics: {
    likes: number[];
    reposts: number[];
    comments: number[];
  };
} 