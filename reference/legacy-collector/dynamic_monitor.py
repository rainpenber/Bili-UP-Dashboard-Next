import os
import time
import csv
import json
import hashlib
import hmac
import urllib.parse
import configparser
import requests
import qrcode
from datetime import datetime, timedelta
import threading
import sys
from io import StringIO

# 全局变量
CONFIG_FILE = 'video_config.conf'
COOKIE_FILE = 'cookie.txt'
SESSION_FILE = 'session.json'
WBI_CACHE_FILE = 'wbi_cache.json'

# 常量
MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
]

# 用户代理
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'

class BiliAPI:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': USER_AGENT,
            'Referer': 'https://www.bilibili.com/',
            'Origin': 'https://www.bilibili.com'
        })
        self.wbi_keys = None
        self.wbi_keys_time = 0
        self.load_cookies()
        
    def load_cookies(self):
        """加载Cookie"""
        if os.path.exists(COOKIE_FILE):
            with open(COOKIE_FILE, 'r') as f:
                cookie_str = f.read().strip()
                if cookie_str:
                    cookie_dict = {}
                    for item in cookie_str.split(';'):
                        if '=' in item:
                            key, value = item.strip().split('=', 1)
                            cookie_dict[key] = value
                    self.session.cookies.update(cookie_dict)
                    print("已从文件加载Cookie")
                    return True
        
        if os.path.exists(SESSION_FILE):
            try:
                with open(SESSION_FILE, 'r') as f:
                    session_data = json.load(f)
                    for cookie in session_data.get('cookies', []):
                        self.session.cookies.set(cookie['name'], cookie['value'])
                    print("已从会话文件加载Cookie")
                    return True
            except Exception as e:
                print(f"加载会话文件失败: {e}")
        
        print("未找到有效的Cookie，需要登录")
        return False
    
    def save_session(self):
        """保存会话信息"""
        cookies_dict = [{'name': k, 'value': v} for k, v in self.session.cookies.items()]
        session_data = {
            'cookies': cookies_dict,
            'time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }
        with open(SESSION_FILE, 'w') as f:
            json.dump(session_data, f)
        print("会话信息已保存")
    
    def login_qrcode(self):
        """使用二维码登录"""
        while True:  # 添加循环以支持重试
            print("开始获取登录二维码...")
            try:
                # 使用新的二维码生成接口
                qr_resp = self.session.get('https://passport.bilibili.com/x/passport-login/web/qrcode/generate')
                qr_data = qr_resp.json()
                
                if qr_data['code'] != 0:
                    print(f"获取二维码失败: {qr_data['message']}")
                    return False
                
                qr_url = qr_data['data']['url']
                qrcode_key = qr_data['data']['qrcode_key']
                
                # 清屏并显示二维码
                print("\033[2J\033[H")  # 清屏
                print("\n请使用B站APP扫描以下二维码登录:")
                
                # 生成并显示二维码
                qr = qrcode.QRCode()
                qr.add_data(qr_url)
                qr.make(fit=True)
                
                # 将二维码输出到控制台
                f = StringIO()
                qr.print_ascii(out=f)
                f.seek(0)
                print(f.read())
                print("扫描后请在手机上确认登录...\n")
                
                # 轮询登录状态
                last_status = None  # 用于记录上一次的状态
                for i in range(90):  # 最多等待90秒
                    time.sleep(1)
                    try:
                        # 使用新的状态查询接口
                        check_resp = self.session.get(
                            'https://passport.bilibili.com/x/passport-login/web/qrcode/poll',
                            params={'qrcode_key': qrcode_key}
                        )
                        check_data = check_resp.json()
                        
                        if check_data['code'] != 0:
                            continue
                        
                        data = check_data['data']
                        code = data.get('code', 0)
                        
                        if code == 0:
                            # 登录成功
                            print("\n登录成功!")
                            self.save_session()
                            return True
                        elif code == 86038:
                            print("\n二维码已失效，是否重新生成二维码？(y/n)")
                            if input().lower() == 'y':
                                break  # 跳出内层循环，重新生成二维码
                            return False
                        elif code == 86090:
                            if last_status != 86090:
                                print("\n二维码已扫描，请在手机上确认...")
                                last_status = 86090
                        elif code == 86101:
                            # 等待扫码中，不输出任何信息
                            pass
                        
                    except Exception as e:
                        print(f"\n检查登录状态时出错: {e}")
                        return False
                
                if i >= 89:  # 超时
                    print("\n登录超时，是否重新生成二维码？(y/n)")
                    if input().lower() != 'y':
                        return False
                    # 如果用户选择重试，会继续外层循环
                    
            except Exception as e:
                print(f"\n登录过程出现错误: {e}")
                return False
    
    def get_bili_ticket(self):
        """获取bili_ticket"""
        timestamp = int(time.time())
        key = "XgwSnGZ1p"
        message = f"ts{timestamp}"
        
        # 使用HMAC-SHA256算法计算hexsign
        hexsign = hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest()
        
        params = {
            "key_id": "ec02",
            "hexsign": hexsign,
            "context[ts]": timestamp,
            "csrf": self.session.cookies.get('bili_jct', '')
        }
        
        response = self.session.post("https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket", params=params)
        data = response.json()
        
        if data['code'] == 0:
            ticket = data['data']['ticket']
            self.session.cookies.set('bili_ticket', ticket)
            return ticket
        return None
    
    def get_wbi_keys(self, force_refresh=False):
        """获取WBI签名所需的img_key和sub_key"""
        # 检查缓存
        current_time = time.time()
        if not force_refresh and self.wbi_keys and current_time - self.wbi_keys_time < 3600:  # 缓存1小时
            return self.wbi_keys
        
        # 尝试从缓存文件加载
        if not force_refresh and os.path.exists(WBI_CACHE_FILE):
            try:
                with open(WBI_CACHE_FILE, 'r') as f:
                    cache_data = json.load(f)
                    cache_time = cache_data.get('time', 0)
                    if current_time - cache_time < 3600:  # 缓存1小时有效
                        self.wbi_keys = (cache_data['img_key'], cache_data['sub_key'])
                        self.wbi_keys_time = cache_time
                        return self.wbi_keys
            except Exception as e:
                print(f"读取WBI缓存失败: {e}")
        
        # 从API获取
        try:
            response = self.session.get('https://api.bilibili.com/x/web-interface/nav')
            data = response.json()
            
            if data['code'] != 0:
                # 尝试使用bili_ticket接口
                self.get_bili_ticket()
                response = self.session.get('https://api.bilibili.com/x/web-interface/nav')
                data = response.json()
                
                if data['code'] != 0:
                    print(f"获取WBI密钥失败: {data}")
                    return None, None
            
            img_url = data['data']['wbi_img']['img_url']
            sub_url = data['data']['wbi_img']['sub_url']
            
            img_key = img_url.rsplit('/', 1)[1].split('.')[0]
            sub_key = sub_url.rsplit('/', 1)[1].split('.')[0]
            
            self.wbi_keys = (img_key, sub_key)
            self.wbi_keys_time = current_time
            
            # 保存到缓存文件
            with open(WBI_CACHE_FILE, 'w') as f:
                json.dump({
                    'img_key': img_key,
                    'sub_key': sub_key,
                    'time': current_time
                }, f)
            
            return self.wbi_keys
        except Exception as e:
            print(f"获取WBI密钥出错: {e}")
            return None, None
    
    def get_mixin_key(self, img_key, sub_key):
        """生成mixin key"""
        orig = img_key + sub_key
        return ''.join([orig[MIXIN_KEY_ENC_TAB[i]] for i in range(32)])
    
    def sign_wbi(self, params):
        """使用WBI签名参数"""
        img_key, sub_key = self.get_wbi_keys()
        if not img_key or not sub_key:
            return params
        
        mixin_key = self.get_mixin_key(img_key, sub_key)
        curr_time = int(time.time())
        params['wts'] = curr_time
        
        # 按照key排序
        params = dict(sorted(params.items()))
        
        # 过滤value中的特殊字符
        params = {k: str(v).replace("!", "").replace("'", "").replace("(", "").replace(")", "").replace("*", "") for k, v in params.items()}
        
        # 拼接参数
        query = urllib.parse.urlencode(params)
        
        # 计算w_rid
        w_rid = hashlib.md5((query + mixin_key).encode()).hexdigest()
        params['w_rid'] = w_rid
        
        return params
    
    def get_dynamic_detail(self, dynamic_id):
        """获取动态详情"""
        params = {
            'id': dynamic_id,
            'timezone_offset': -480,
            'features': 'itemOpusStyle,opusBigCover,onlyfansVote'
        }
        
        # 添加WBI签名
        signed_params = self.sign_wbi(params)
        
        try:
            response = self.session.get('https://api.bilibili.com/x/polymer/web-dynamic/v1/detail', params=signed_params)
            data = response.json()
            
            if data['code'] != 0:
                print(f"获取动态详情失败: {data}")
                if data['code'] == -352:  # 风控校验失败
                    print("尝试刷新WBI密钥...")
                    self.get_wbi_keys(force_refresh=True)
                    signed_params = self.sign_wbi(params)
                    response = self.session.get('https://api.bilibili.com/x/polymer/web-dynamic/v1/detail', params=signed_params)
                    data = response.json()
                    if data['code'] != 0:
                        print(f"刷新WBI密钥后仍然失败: {data}")
                        return None
                else:
                    return None
            
            return data['data']
        except Exception as e:
            print(f"获取动态详情出错: {e}")
            return None

class DynamicMonitor:
    def __init__(self):
        self.config = configparser.ConfigParser()
        self.api = BiliAPI()
        self.tasks = []
        self.running = True
    
    def load_config(self):
        """加载配置文件"""
        self.config.read(CONFIG_FILE)
        self.tasks = []
        
        for section in self.config.sections():
            if section.startswith('detail_'):
                detail_id = section.split('_')[1]
                if self.config.getboolean(section, 'enabled', fallback=True):
                    interval = self.config.getint(section, 'interval', fallback=5)
                    interval_unit = self.config.get(section, 'interval_unit', fallback='minutes')
                    
                    # 转换为秒
                    if interval_unit == 'minutes':
                        interval_seconds = interval * 60
                    elif interval_unit == 'hours':
                        interval_seconds = interval * 3600
                    else:
                        interval_seconds = interval * 60  # 默认为分钟
                    
                    self.tasks.append({
                        'detail_id': detail_id,
                        'interval': interval_seconds,
                        'next_run': time.time()
                    })
        
        print(f"已加载 {len(self.tasks)} 个动态监控任务")
    
    def ensure_login(self):
        """确保已登录"""
        if not self.api.load_cookies():
            if not self.api.login_qrcode():
                print("登录失败，程序退出")
                sys.exit(1)
    
    def save_data(self, detail_id, data):
        """保存数据到CSV文件"""
        filename = f"{detail_id}_detailcount.csv"
        file_exists = os.path.exists(filename)
        
        with open(filename, 'a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            
            if not file_exists:
                writer.writerow(['时间', '点赞数', '转发数', '评论数'])
            
            current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            writer.writerow([
                current_time,
                data['like_count'],
                data['forward_count'],
                data['comment_count']
            ])
        
        print(f"已保存动态 {detail_id} 的数据: 点赞={data['like_count']}, 转发={data['forward_count']}, 评论={data['comment_count']}")
    
    def process_dynamic(self, detail_id):
        """处理单个动态"""
        detail_data = self.api.get_dynamic_detail(detail_id)
        if not detail_data:
            print(f"获取动态 {detail_id} 详情失败")
            return False
        
        try:
            module_stat = detail_data['item']['modules']['module_stat']
            data = {
                'like_count': module_stat['like']['count'],
                'forward_count': module_stat['forward']['count'],
                'comment_count': module_stat['comment']['count']
            }
            self.save_data(detail_id, data)
            return True
        except Exception as e:
            print(f"处理动态 {detail_id} 数据出错: {e}")
            return False
    
    def run_task(self, task):
        """运行单个任务"""
        while self.running:
            current_time = time.time()
            if current_time >= task['next_run']:
                print(f"执行动态 {task['detail_id']} 的监控任务")
                success = self.process_dynamic(task['detail_id'])
                
                # 更新下次运行时间
                task['next_run'] = current_time + task['interval']
                
                if not success:
                    # 如果失败，稍微延迟一下再重试
                    time.sleep(10)
            
            # 休眠一段时间
            time.sleep(5)
    
    def run(self):
        """运行监控程序"""
        self.ensure_login()
        self.load_config()
        
        if not self.tasks:
            print("没有找到有效的动态监控任务，请检查配置文件")
            return
        
        # 为每个任务创建线程
        threads = []
        for task in self.tasks:
            thread = threading.Thread(target=self.run_task, args=(task,))
            thread.daemon = True
            threads.append(thread)
            thread.start()
        
        try:
            # 主线程保持运行
            while self.running:
                time.sleep(1)
        except KeyboardInterrupt:
            print("接收到退出信号，正在停止...")
            self.running = False
            
            # 等待所有线程结束
            for thread in threads:
                thread.join(timeout=5)
            
            print("程序已退出")

if __name__ == "__main__":
    monitor = DynamicMonitor()
    monitor.run() 