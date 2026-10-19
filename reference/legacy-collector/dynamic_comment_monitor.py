import os
import time
import csv
import json
import logging
import configparser
import requests
import qrcode
import hashlib
import hmac
import urllib.parse
from datetime import datetime
from io import StringIO

# 全局常量
CONFIG_FILE = 'video_lottery.conf'
COOKIE_FILE = 'cookie.txt'
SESSION_FILE = 'session.json'
LOG_FILE = 'comment_log.log'
WBI_CACHE_FILE = 'wbi_cache.json'

# 用户代理
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'

# WBI 混合密钥表
MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
]

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

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
                last_status = None
                for i in range(90):  # 最多等待90秒
                    time.sleep(1)
                    try:
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
                            print("\n登录成功!")
                            self.save_session()
                            return True
                        elif code == 86038:
                            print("\n二维码已失效，是否重新生成二维码？(y/n)")
                            if input().lower() == 'y':
                                break
                            return False
                        elif code == 86090:
                            if last_status != 86090:
                                print("\n二维码已扫描，请在手机上确认...")
                                last_status = 86090
                        elif code == 86101:
                            pass
                        
                    except Exception as e:
                        print(f"\n检查登录状态时出错: {e}")
                        return False
                
                if i >= 89:
                    print("\n登录超时，是否重新生成二维码？(y/n)")
                    if input().lower() != 'y':
                        return False
                    
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
                logger.error(f"读取WBI缓存失败: {e}")
        
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
                    logger.error(f"获取WBI密钥失败: {data}")
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
            logger.error(f"获取WBI密钥出错: {e}")
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

    def get_dynamic_comments(self, dynamic_id, pn=1, ps=20):
        """获取动态评论"""
        params = {
            'type': 11,  # 图文动态的type值为11
            'oid': dynamic_id,
            'mode': 3,  # 按热度排序
            'plat': 1,
            'web_location': 1315875,  # 添加必要的web_location参数
        }
        
        # 第一页的参数
        if pn == 1:
            params['seek_rpid'] = ''
            params['pagination_str'] = json.dumps({"offset": ""})
        else:
            # 从响应中获取session_id，如果没有则使用时间戳
            session_id = getattr(self, '_session_id', str(int(time.time() * 1000)))
            # 第二页及以后的分页参数
            pagination_str = {
                'offset': json.dumps({
                    'type': 1,
                    'direction': 1,
                    'session_id': session_id,
                    'data': {}
                })
            }
            params['pagination_str'] = json.dumps(pagination_str)
        
        # 添加 WBI 签名
        params = self.sign_wbi(params)
        
        try:
            response = self.session.get('https://api.bilibili.com/x/v2/reply/wbi/main', params=params)
            data = response.json()
            
            if data['code'] != 0:
                # 记录失败的请求和响应详情
                logger.error(f"获取评论失败 - 请求详情:")
                logger.error(f"URL: {response.url}")
                logger.error(f"Headers: {json.dumps(dict(response.request.headers), ensure_ascii=False, indent=2)}")
                logger.error(f"Params: {json.dumps(params, ensure_ascii=False, indent=2)}")
                logger.error(f"响应详情:")
                logger.error(f"Status Code: {response.status_code}")
                logger.error(f"Response Headers: {json.dumps(dict(response.headers), ensure_ascii=False, indent=2)}")
                logger.error(f"Response Body: {json.dumps(data, ensure_ascii=False, indent=2)}")
                
                if data['code'] == -403:  # 访问权限不足
                    logger.info("尝试刷新bili_ticket...")
                    if self.get_bili_ticket():  # 刷新bili_ticket
                        # 重试请求
                        response = self.session.get('https://api.bilibili.com/x/v2/reply/wbi/main', params=params)
                        data = response.json()
                        if data['code'] == 0:
                            # 保存session_id用于后续请求
                            if 'cursor' in data['data'] and 'session_id' in data['data']['cursor']:
                                self._session_id = data['data']['cursor']['session_id']
                            return data['data']
                
                if data['code'] == -352:  # 风控校验失败
                    logger.info("尝试刷新WBI密钥...")
                    self.get_wbi_keys(force_refresh=True)
                    params = self.sign_wbi(params)
                    response = self.session.get('https://api.bilibili.com/x/v2/reply/wbi/main', params=params)
                    data = response.json()
                    if data['code'] != 0:
                        logger.error(f"刷新WBI密钥后仍然失败: {data}")
                        return None
                
                print(f"获取评论失败: {data['message']} (详细信息已记录到{LOG_FILE})")
                return None
            
            # 保存session_id用于后续请求
            if 'cursor' in data['data'] and 'session_id' in data['data']['cursor']:
                self._session_id = data['data']['cursor']['session_id']
            
            return data['data']
        except Exception as e:
            # 记录异常详情
            logger.error(f"获取评论出错 - 异常信息: {str(e)}")
            logger.error(f"请求详情:")
            logger.error(f"URL: https://api.bilibili.com/x/v2/reply/wbi/main")
            logger.error(f"Params: {json.dumps(params, ensure_ascii=False, indent=2)}")
            print(f"获取评论出错: {e} (详细信息已记录到{LOG_FILE})")
            return None

class CommentMonitor:
    def __init__(self):
        self.config = configparser.ConfigParser()
        self.api = BiliAPI()
        self.dynamic_id = None
        self.interval = None
        self.interval_unit = None
        
    def load_config(self):
        """加载配置文件"""
        self.config.read(CONFIG_FILE)
        self.dynamic_id = self.config.get('detail', 'detail_id')
        self.interval = self.config.getint('detail', 'interval')
        self.interval_unit = self.config.get('detail', 'interval_unit')
        
        # 转换为秒
        if self.interval_unit == 'minutes':
            self.interval = self.interval * 60
        elif self.interval_unit == 'hours':
            self.interval = self.interval * 3600
        
        print(f"已加载配置：动态ID={self.dynamic_id}, 间隔={self.interval}秒")
    
    def ensure_login(self):
        """确保已登录"""
        if not self.api.load_cookies():
            if not self.api.login_qrcode():
                print("登录失败，程序退出")
                return False
        return True
    
    def save_comments_to_csv(self, comments, filename):
        """保存评论到CSV文件"""
        file_exists = os.path.exists(filename)
        
        with open(filename, 'a', newline='', encoding='utf-8-sig') as f:
            writer = csv.writer(f)
            
            if not file_exists:
                writer.writerow(['评论时间', '用户昵称', '用户UID', '评论内容'])
            
            for comment in comments:
                ctime = datetime.fromtimestamp(comment['ctime']).strftime('%Y-%m-%d %H:%M:%S')
                uname = comment['member']['uname']
                uid = comment['member']['mid']
                content = comment['content']['message'].replace('\n', ' ')
                
                writer.writerow([ctime, uname, uid, content])
    
    def run(self):
        """运行监控程序"""
        self.load_config()
        if not self.ensure_login():
            return
        
        filename = f"{self.dynamic_id}_commentlist.csv"
        print(f"评论将保存到: {filename}")
        
        pn = 1
        while True:
            print(f"\n获取第{pn}页评论...")
            data = self.api.get_dynamic_comments(self.dynamic_id, pn=pn)
            
            if not data or not data.get('replies'):
                print("没有更多评论了")
                break
            
            self.save_comments_to_csv(data['replies'], filename)
            print(f"已保存第{pn}页评论")
            
            # 检查是否还有下一页
            cursor = data.get('cursor', {})
            if cursor.get('is_end', False):
                print("已获取所有评论")
                break
            
            pn += 1
            print(f"等待{self.interval}秒后获取下一页...")
            time.sleep(self.interval)

if __name__ == "__main__":
    monitor = CommentMonitor()
    monitor.run() 