import requests
import csv
import time
import schedule
import configparser
import sys
from datetime import datetime
from pathlib import Path

# 设置控制台输出编码
if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')

class Config:
    def __init__(self):
        self.config_file = 'video_config.conf'
        self.load_config()

    def load_config(self):
        config = configparser.ConfigParser()
        try:
            config.read(self.config_file, encoding='utf-8')
            # 读取多个mid并转换为整数列表
            mid_str = config.get('user', 'mids')
            self.mids = [int(mid.strip()) for mid in mid_str.split(',')]
            if not self.mids:
                raise ValueError("未配置用户mid")
        except Exception as e:
            print(f"读取配置文件失败: {e}")
            sys.exit(1)

def get_cookies():
    """从cookie.txt文件中读取cookie"""
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

def get_follower_stat(mid, cookies):
    """获取用户粉丝数 /x/relation/stat"""
    url = 'https://api.bilibili.com/x/relation/stat'
    params = {'vmid': mid}
    headers = {
        'User-Agent': 'Mozilla/5.0'
    }
    
    try:
        response = requests.get(url, params=params, cookies=cookies, headers=headers)
        response.raise_for_status()
        data = response.json()
        if data['code'] == 0:
            return data['data']['follower']
    except Exception as e:
        print(f"获取用户 {mid} 的粉丝数据失败: {e}")
    return None

def append_to_csv(mid, follower_count):
    """将数据写入CSV文件"""
    filename = f'{mid}_follower.csv'
    file_exists = Path(filename).exists()
    
    try:
        with open(filename, 'a', newline='', encoding='utf-8-sig') as csvfile:
            fieldnames = ['时间', '粉丝数']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            
            if not file_exists:
                writer.writeheader()
            
            writer.writerow({
                '时间': datetime.now().strftime('%Y-%m-%d %H:%M'),
                '粉丝数': follower_count
            })
            print(f"用户 {mid} 的数据已写入CSV文件")
    except Exception as e:
        print(f"写入用户 {mid} 的CSV文件失败: {e}")

def job(config):
    """定时任务"""
    cookies = get_cookies()
    current_time = datetime.now().strftime('%Y-%m-%d %H:%M')
    print(f"\n开始获取数据 - {current_time}")
    
    for mid in config.mids:
        follower_count = get_follower_stat(mid, cookies)
        if follower_count is not None:
            print(f"用户 {mid} 当前粉丝数: {follower_count}")
            append_to_csv(mid, follower_count)
        else:
            print(f"用户 {mid} 获取粉丝数据失败")
        
        # 两次查询之间间隔30秒
        if mid != config.mids[-1]:  # 如果不是最后一个用户
            print(f"等待30秒后查询下一个用户...")
            time.sleep(30)

def main():
    # 加载配置
    config = Config()
    
    print(f"开始监控以下用户的粉丝数据:")
    for mid in config.mids:
        print(f"- 用户 {mid}")
    
    # 立即执行一次
    job(config)
    
    # 设置定时任务，每小时执行一次
    schedule.every(4).hours.do(job, config)

    print("\n监控脚本已启动，按Ctrl+C停止")
    try:
        while True:
            schedule.run_pending()
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n脚本已被用户停止")

if __name__ == "__main__":
    main() 