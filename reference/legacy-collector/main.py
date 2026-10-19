import requests
import csv
import time
import schedule
import configparser
import sys
import logging
from datetime import datetime
from pathlib import Path

# 设置控制台输出编码
if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')

# 设置日志记录
def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('video_monitor.log', encoding='utf-8'),
            logging.StreamHandler(sys.stdout)
        ]
    )

class Config:
    def __init__(self):
        self.config_file = 'video_config.conf'
        self.videos = []  # 存储多个视频的配置
        self.load_config()

    def load_config(self):
        config = configparser.ConfigParser()
        try:
            config.read(self.config_file, encoding='utf-8')
            
            # 读取所有以video_开头的section
            for section in config.sections():
                if section.startswith('video_'):
                    video_config = {
                        'enabled': config.getboolean(section, 'enabled', fallback=True),  # 默认为启用
                        'bvid': config.get(section, 'bvid'),
                        'start_now': config.getboolean(section, 'start_now'),
                        'start_time': config.get(section, 'start_time'),
                        'interval': config.getint(section, 'interval'),
                        'interval_unit': config.get(section, 'interval_unit', fallback='minutes'),
                        'cid': config.get(section, 'cid', fallback='')
                    }
                    if video_config['cid'] == '':
                        video_config['cid'] = None
                    self.videos.append(video_config)
                    
            if not self.videos:
                raise ValueError("未找到视频配置")
            
            # 检查是否有启用的视频
            enabled_videos = [v for v in self.videos if v['enabled']]
            if not enabled_videos:
                raise ValueError("没有启用的视频配置")
                
        except Exception as e:
            print(f"读取配置文件失败: {e}")
            sys.exit(1)

    def save_cid(self, bvid, cid):
        config = configparser.ConfigParser()
        try:
            config.read(self.config_file, encoding='utf-8')
            section = f'video_{bvid}'
            
            if section in config:
                config.set(section, 'cid', str(cid))
                
                # 使用临时文件写入新配置
                temp_file = Path(self.config_file + '.tmp')
                with temp_file.open('w', encoding='utf-8') as configfile:
                    config.write(configfile)
                
                # 替换原文件
                temp_file.replace(Path(self.config_file))
                
                # 更新内存中的配置
                for video in self.videos:
                    if video['bvid'] == bvid:
                        video['cid'] = str(cid)
                        break
                
                print(f"视频 {bvid} 的CID已更新到配置文件: {cid}")
        except Exception as e:
            print(f"更新CID到配置文件失败: {e}")

# 从cookie.txt文件中读取cookie
def get_cookies():
    cookies = {}
    try:
        with open('cookie.txt', 'r', encoding='utf-8') as f:
            for line in f:
                if '=' in line:
                    name, value = line.strip().split('=', 1)
                    cookies[name] = value
        print("Cookies加载成功")
    except Exception as e:
        print(f"加载Cookies失败: {e}")
    return cookies

# 获取视频cid
def get_video_view(bvid, cookies, headers):
    """获取视频基本信息 /x/web-interface/view"""
    url = 'https://api.bilibili.com/x/web-interface/view'
    params = {'bvid': bvid}
    
    try:
        response = requests.get(url, params=params, cookies=cookies, headers=headers)
        response.raise_for_status()
        data = response.json()
        if data['code'] == 0:
            return {
                'cid': data['data']['cid'],
                'title': data['data']['title'],
                'pubdate': data['data']['pubdate']
            }
    except Exception as e:
        print(f"获取视频信息失败: {e}")
    return None

def try_get_cid(config):
    """尝试获取CID的独立函数"""
    if config.cid:  # 如果已有CID则直接返回
        return True
        
    cookies = get_cookies()
    headers = {
        'User-Agent': 'Mozilla/5.0'
    }
    
    retry_count = 0
    while not config.cid and retry_count < 3:  # 最多重试3次
        video_info = get_video_view(config.bvid, cookies, headers)
        if video_info:
            config.cid = str(video_info['cid'])
            config.save_cid(config.bvid, config.cid)
            print(f"成功获取视频信息：\nCID: {config.cid}\n标题: {video_info['title']}")
            return True
        else:
            retry_count += 1
            if retry_count < 3:
                print(f"第{retry_count}次获取CID失败，5秒后重试...")
                time.sleep(5)
            else:
                print("无法获取视频CID")
                return False
    return False

def get_online_total(video_config, cookies, headers):
    """获取实时在线观看数据 /x/player/online/total"""
    url = 'https://api.bilibili.com/x/player/online/total'
    params = {
        'bvid': video_config['bvid'],
        'cid': video_config['cid']
    }
    
    try:
        response = requests.get(url, params=params, cookies=cookies, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        # 检查API返回的业务状态码
        if data.get('code') != 0:
            error_msg = f"视频 {video_config['bvid']} 在线观看数据API返回错误: {data.get('message', '未知错误')}"
            logging.error(error_msg)
            return None
            
        return data.get('data', {}).get('total', 0)
    except requests.exceptions.HTTPError as e:
        if response.status_code == 404:
            error_msg = f"视频 {video_config['bvid']} 不存在或已设为私有 (404)"
            logging.error(error_msg)
        else:
            error_msg = f"获取视频 {video_config['bvid']} 在线观看数据失败: HTTP {response.status_code}"
            logging.error(error_msg)
        return None
    except requests.exceptions.RequestException as e:
        error_msg = f"获取视频 {video_config['bvid']} 在线观看数据失败: {e}"
        logging.error(error_msg)
        return None

def get_video_stat(video_config, cookies, headers):
    """获取视频统计数据 /x/web-interface/view"""
    url = 'https://api.bilibili.com/x/web-interface/view'
    params = {
        'bvid': video_config['bvid']
    }
    
    try:
        response = requests.get(url, params=params, cookies=cookies, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        # 检查API返回的业务状态码
        if data.get('code') != 0:
            error_msg = f"视频 {video_config['bvid']} 统计数据API返回错误: {data.get('message', '未知错误')}"
            logging.error(error_msg)
            return None
            
        stat = data.get('data', {}).get('stat', {})
        
        return {
            'view': stat.get('view', 0),
            'like': stat.get('like', 0),
            'coin': stat.get('coin', 0),
            'favorite': stat.get('favorite', 0),
            'share': stat.get('share', 0),
            'danmaku': stat.get('danmaku', 0)
        }
    except requests.exceptions.HTTPError as e:
        if response.status_code == 404:
            error_msg = f"视频 {video_config['bvid']} 不存在或已设为私有 (404)"
            logging.error(error_msg)
        else:
            error_msg = f"获取视频 {video_config['bvid']} 统计数据失败: HTTP {response.status_code}"
            logging.error(error_msg)
        return None
    except requests.exceptions.RequestException as e:
        error_msg = f"获取视频 {video_config['bvid']} 统计数据失败: {e}"
        logging.error(error_msg)
        return None

def fetch_data(config):
    """获取所有数据"""
    if not config.cid:
        print("缺少CID，无法获取数据")
        return None
        
    cookies = get_cookies()
    headers = {
        'User-Agent': 'Mozilla/5.0'
    }
    
    # 获取在线观看数据
    online_total = get_online_total(config, cookies, headers)
    
    # 获取视频统计数据
    stats = get_video_stat(config, cookies, headers)
    
    # 确保 online_total 是整数类型
    online_total = int(online_total) if isinstance(online_total, str) else online_total
    
    # 检查是否获取到有效数据
    if online_total > 0 or any(value > 0 for value in stats.values()):
        print("数据获取成功")
    else:
        print("警告：所有数据值都为0，可能获取失败")
    
    return {
        '时间': datetime.now().strftime('%Y-%m-%d %H:%M'),
        '播放量': stats['view'],
        '在线观看人数': online_total,
        '点赞': stats['like'],
        '投币': stats['coin'], 
        '收藏': stats['favorite'],
        '分享': stats['share'],
        '弹幕': stats['danmaku']
    }

def append_to_csv(data, video_config):
    """将数据写入CSV文件"""
    filename = f'{video_config["bvid"]}_views.csv'
    file_exists = Path(filename).exists()
    
    try:
        with open(filename, 'a', newline='', encoding='utf-8-sig') as csvfile:
            fieldnames = ['时间', '播放量', '在线观看人数', '点赞', '投币', '收藏', '分享', '弹幕']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            
            if not file_exists:
                writer.writeheader()
            
            writer.writerow(data)
            print(f"视频 {video_config['bvid']} 的数据已写入CSV文件")
    except Exception as e:
        print(f"写入CSV文件失败: {e}")

def job(config):
    data = fetch_data(config)
    if data:
        append_to_csv(data, config)

def schedule_video_task(schedule_obj, video_config, job_func, config):
    """设置视频的定时任务"""
    interval = video_config['interval']
    unit = video_config['interval_unit'].lower()
    
    if unit == 'seconds':
        schedule_obj.every(interval).seconds.do(job_func, video_config, config)
    elif unit == 'minutes':
        schedule_obj.every(interval).minutes.do(job_func, video_config, config)
    elif unit == 'hours':
        schedule_obj.every(interval).hours.do(job_func, video_config, config)
    else:
        print(f"警告：视频 {video_config['bvid']} 的时间单位 {unit} 无效，默认使用分钟")
        schedule_obj.every(interval).minutes.do(job_func, video_config, config)
    
    unit_str = {
        'seconds': '秒',
        'minutes': '分钟',
        'hours': '小时'
    }.get(unit, '分钟')
    
    print(f"已设置视频 {video_config['bvid']} 的监控间隔为 {interval} {unit_str}")

def main():
    # 设置日志记录
    setup_logging()
    
    # 加载配置
    config = Config()
    
    # 为每个启用的视频创建单独的任务
    for video_config in config.videos:
        if not video_config['enabled']:
            print(f"视频 {video_config['bvid']} 未启用，跳过")
            continue
            
        bvid = video_config['bvid']
        print(f"正在设置视频 {bvid} 的监控任务...")
        
        if video_config['start_now']:
            print(f"立即开始监控视频 {bvid}...")
            if not video_config['cid']:
                if try_get_cid_for_video(video_config, config):
                    job_for_video(video_config, config)
                else:
                    print(f"无法获取视频 {bvid} 的CID，跳过该视频")
                    continue
            else:
                job_for_video(video_config, config)
        else:
            # 处理定时启动的逻辑...
            pass

        # 设置每个视频的定时任务
        schedule_video_task(schedule, video_config, job_for_video, config)

    enabled_count = sum(1 for v in config.videos if v['enabled'])
    print(f"\n已启动 {enabled_count} 个视频的监控任务，按Ctrl+C停止")
    try:
        while True:
            schedule.run_pending()
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n脚本已被用户停止")

def job_for_video(video_config, config):
    """针对单个视频的任务"""
    # 尝试获取CID，如果没有CID则主动查询
    if not video_config['cid']:
        print(f"视频 {video_config['bvid']} 缺少CID，尝试获取...")
        if not try_get_cid_for_video(video_config, config):
            print(f"视频 {video_config['bvid']} 的CID获取失败，跳过该视频")
            return  # 如果获取CID失败，直接返回

    # 继续获取数据
    data = fetch_data_for_video(video_config, config)
    if data:
        append_to_csv(data, video_config)

def fetch_data_for_video(video_config, config):
    """获取单个视频的数据"""
    if not video_config['cid']:
        error_msg = f"视频 {video_config['bvid']} 缺少CID，无法获取数据"
        logging.error(error_msg)
        return None
        
    cookies = get_cookies()
    headers = {
        'User-Agent': 'Mozilla/5.0'
    }
    
    online_total = get_online_total(video_config, cookies, headers)
    stats = get_video_stat(video_config, cookies, headers)
    
    # 如果两个关键数据都获取失败，则跳过该视频
    if online_total is None and stats is None:
        error_msg = f"视频 {video_config['bvid']} 所有数据获取失败，跳过该视频"
        logging.error(error_msg)
        return None
    
    # 如果其中一个失败，用0填充
    if online_total is None:
        online_total = 0
        logging.warning(f"视频 {video_config['bvid']} 在线观看数据获取失败，使用0填充")
    
    if stats is None:
        stats = {
            'view': 0,
            'like': 0,
            'coin': 0,
            'favorite': 0,
            'share': 0,
            'danmaku': 0
        }
        logging.warning(f"视频 {video_config['bvid']} 统计数据获取失败，使用0填充")
    
    # 处理在线观看人数的特殊格式
    if isinstance(online_total, str):
        if online_total.endswith('+'):
            try:
                online_total = int(online_total[:-1])  # 去掉"+"号并转换为整数
            except ValueError:
                logging.warning(f"视频 {video_config['bvid']} 在线观看数据格式异常: {online_total}")
                online_total = 0
        else:
            try:
                online_total = int(online_total)
            except ValueError:
                logging.warning(f"视频 {video_config['bvid']} 在线观看数据格式异常: {online_total}")
                online_total = 0
    
    if online_total > 0 or any(value > 0 for value in stats.values()):
        logging.info(f"视频 {video_config['bvid']} 数据获取成功")
    else:
        logging.warning(f"视频 {video_config['bvid']} 所有数据值都为0")
    
    return {
        '时间': datetime.now().strftime('%Y-%m-%d %H:%M'),
        '播放量': stats['view'],
        '在线观看人数': online_total,
        '点赞': stats['like'],
        '投币': stats['coin'], 
        '收藏': stats['favorite'],
        '分享': stats['share'],
        '弹幕': stats['danmaku']
    }

def try_get_cid_for_video(video_config, config):
    """尝试获取单个视频的CID"""
    if video_config['cid']:
        return True
        
    cookies = get_cookies()
    headers = {
        'User-Agent': 'Mozilla/5.0'
    }
    
    retry_count = 0
    while not video_config['cid'] and retry_count < 3:
        video_info = get_video_view(video_config['bvid'], cookies, headers)
        if video_info:
            cid = str(video_info['cid'])
            config.save_cid(video_config['bvid'], cid)  # 更新配置文件
            video_config['cid'] = cid
            print(f"成功获取视频信息：\nBVID: {video_config['bvid']}\nCID: {cid}\n标题: {video_info['title']}")
            return True
        else:
            retry_count += 1
            if retry_count < 3:
                print(f"第{retry_count}次获取CID失败，5秒后重试...")
                time.sleep(5)
            else:
                print(f"无法获取视频 {video_config['bvid']} 的CID")
                return False
    return False

if __name__ == "__main__":
    main()
