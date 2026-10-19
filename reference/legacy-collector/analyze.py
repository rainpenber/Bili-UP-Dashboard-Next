import os
import pandas as pd
import json
from datetime import datetime, timedelta
import configparser
import time  # 导入time模块以实现定期运行

# 读取配置文件
def read_config():
    config = configparser.ConfigParser()
    config.read('video_config.conf')
    interval = int(config['analyze']['interval'])
    interval_unit = config['analyze']['interval_unit']
    dev_mode = config.getboolean('analyze', 'dev_mode', fallback=False)  # 读取调试模式配置
    
    time_units = {
        'hours': timedelta(hours=interval),
        'minutes': timedelta(minutes=interval),
        'days': timedelta(days=interval)
    }
    
    if interval_unit in time_units:
        print(f"配置读取成功: 每 {interval} {interval_unit} 整理一次数据。")  # 输出配置读取成功信息
        return time_units[interval_unit], dev_mode  # 返回间隔和调试模式
    else:
        raise ValueError("不支持的时间单位")

# 定义数据变化的判断标准
def determine_change(value, time_frame, is_view=True):
    if is_view:  # 如果是播放量
        if time_frame == '1d':
            if value > 5000:
                return '1d_Rising'
            elif value > 0:
                return 'climbing'
            elif value < 0:
                return '1d_Falling'  # 播放量减少
        elif time_frame == '3d':
            if value > 10000:
                return '3d_Rising'
            elif value > 0:
                return 'climbing'
            elif value < 0:
                return '3d_Falling'  # 播放量减少
        elif time_frame == '1w':
            if value > 20000:
                return '1w_Rising'
            elif value > 0:
                return 'climbing'
            elif value < 0:
                return '1w_Falling'  # 播放量减少
        elif time_frame == '1m':
            if value > 50000:
                return '1m_Rising'
            elif value > 0:
                return 'climbing'
            elif value < 0:
                return '1m_Falling'  # 播放量减少
    else:  # 如果是粉丝量
        if time_frame == '1d':
            if value > 2000:
                return '1d_Rising'
            elif value < 0 and value >= -200:
                return 'Sliding'  # 粉丝量波动
            elif value < -200:
                return '1d_Falling'  # 粉丝量减少
            elif value > 0:
                return 'climbing'
            elif value == 0:
                return 'No Change'  # 粉丝量没有变化
        elif time_frame == '3d':
            if value > 5000:
                return '3d_Rising'
            elif value < 0 and value >= -200:
                return 'Sliding'  # 粉丝量波动
            elif value < -200:
                return '3d_Falling'  # 粉丝量减少
            elif value > 0:
                return 'climbing'
            elif value == 0:
                return 'No Change'  # 粉丝量没有变化
        elif time_frame == '1w':
            if value > 10000:
                return '1w_Rising'
            elif value < 0 and value >= -200:
                return 'Sliding'  # 粉丝量波动
            elif value < -200:
                return '1w_Falling'  # 粉丝量减少
            elif value > 0:
                return 'climbing'
            elif value == 0:
                return 'No Change'  # 粉丝量没有变化
        elif time_frame == '1m':
            if value > 50000:
                return '1m_Rising'
            elif value < 0 and value >= -200:
                return 'Sliding'  # 粉丝量波动
            elif value < -200:
                return '1m_Falling'  # 粉丝量减少
            elif value > 0:
                return 'climbing'
            elif value == 0:
                return 'No Change'  # 粉丝量没有变化
    
    return None

# 读取CSV文件并分析数据
def analyze_data():
    changes_view = {}
    changes_follower = {}
    
    # 获取整理间隔和调试模式
    interval, dev_mode = read_config()

    # 获取当前目录下的所有CSV文件
    for filename in os.listdir('.'):
        if filename.endswith('follower.csv'):
            print(f"正在分析粉丝数据文件: {filename}")  # 输出正在分析的文件名
            df_follower = pd.read_csv(filename)
            df_follower['时间'] = pd.to_datetime(df_follower['时间'])  # 确保时间列被解析为日期时间
            df_follower.dropna(inplace=True)  # 删除空行
            user_id = filename.split('_')[0]
            latest_record = df_follower.iloc[-1]
            
            # 检查最新记录的粉丝数是否为0
            if latest_record['粉丝数'] == 0:
                latest_record = df_follower.iloc[-2]  # 使用上一条记录
            
            date_latest = latest_record['时间']  # 使用正确的列名
            
            # 查找1天、3天、一周和一个月前的记录
            for days, time_frame in zip([1, 3, 7, 30], ['1d', '3d', '1w', '1m']):
                date_compare = date_latest - timedelta(days=days)
                record = df_follower[df_follower['时间'].dt.date == date_compare.date()]  # 使用正确的列名
                if not record.empty:
                    earliest_record = record.iloc[0]
                    change = latest_record['粉丝数'] - earliest_record['粉丝数']  # 最新减去之前
                    mark = determine_change(change, time_frame, is_view=False)
                    
                    # 调试输出
                    if dev_mode:
                        print(f"比对粉丝数据: {latest_record['粉丝数']} - {earliest_record['粉丝数']} = {change}, 标记: {mark}")
                    
                    if mark:
                        changes_follower[f"{user_id}"] = mark

        elif filename.endswith('views.csv'):
            print(f"正在分析播放量数据文件: {filename}")  # 输出正在分析的文件名
            df_views = pd.read_csv(filename)
            df_views['时间'] = pd.to_datetime(df_views['时间'])  # 确保时间列被解析为日期时间
            df_views.dropna(inplace=True)  # 删除空行
            video_id = filename.split('_')[0]
            latest_record = df_views.iloc[-1]
            
            # 检查最新记录的播放量是否为0
            if latest_record['播放量'] == 0:
                latest_record = df_views.iloc[-2]  # 使用上一条记录
            
            date_latest = latest_record['时间']  # 使用正确的列名
            
            # 查找1天、3天、一周和一个月前的记录
            for days, time_frame in zip([1, 3, 7, 30], ['1d', '3d', '1w', '1m']):
                date_compare = date_latest - timedelta(days=days)
                record = df_views[df_views['时间'].dt.date == date_compare.date()]  # 使用正确的列名
                if not record.empty:
                    earliest_record = record.iloc[0]
                    change = latest_record['播放量'] - earliest_record['播放量']  # 最新减去之前
                    mark = determine_change(change, time_frame, is_view=True)
                    
                    # 调试输出
                    if dev_mode:
                        print(f"比对播放量数据: {latest_record['播放量']} - {earliest_record['播放量']} = {change}, 标记: {mark}")
                    
                    if mark:
                        changes_view[f"{video_id}"] = mark

    # 保存结果到JSON文件
    with open('changes_view.json', 'w', encoding='utf-8') as f:
        json.dump({"更新时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), **changes_view}, f, ensure_ascii=False, indent=4)
    print("播放量变化结果已保存到 changes_view.json")  # 输出保存结果的状态

    with open('changes_follower.json', 'w', encoding='utf-8') as f:
        json.dump({"更新时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), **changes_follower}, f, ensure_ascii=False, indent=4)
    print("粉丝变化结果已保存到 changes_follower.json")  # 输出保存结果的状态

if __name__ == "__main__":
    try:
        interval, dev_mode = read_config()  # 获取整理间隔和调试模式
        while True:  # 循环运行
            analyze_data()
            time.sleep(interval.total_seconds())  # 等待指定的时间间隔 
    except KeyboardInterrupt:
        print("\n脚本已被手动终止。")  # 友好的终止提示 