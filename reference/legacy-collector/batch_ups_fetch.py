import re
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


# 设置控制台输出编码（Windows）
if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')


def get_cookies():
    """从 cookie.txt 读取 Cookie 字典。"""
    cookies = {}
    try:
        with open('cookie.txt', 'r', encoding='utf-8') as f:
            for line in f:
                if '=' in line:
                    name, value = line.strip().split('=', 1)
                    cookies[name] = value
        print('Cookies加载成功')
    except Exception as e:
        print(f'加载Cookies失败: {e}')
    return cookies


def build_session() -> requests.Session:
    """构建带重试策略的 Session。"""
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    session.headers.update({'User-Agent': 'Mozilla/5.0'})
    return session


def extract_uid_from_url(url: str) -> Optional[str]:
    """
    从个人主页URL中提取 UID（纯数字）。
    常见形式：
    - https://space.bilibili.com/123456
    - https://space.bilibili.com/123456/
    - 也兼容包含其他参数的情况
    """
    # 优先匹配 space.bilibili.com/{uid}
    m = re.search(r"space\.bilibili\.com/(\d+)", url)
    if m:
        return m.group(1)
    # 兜底：取URL中最长的数字串
    numbers = re.findall(r"\d+", url)
    if numbers:
        # 取长度最大者，避免偶尔出现日期/分页号被误取
        return max(numbers, key=len)
    return None


def fetch_user_card(session: requests.Session, cookies: Dict[str, str], mid: str) -> Optional[dict]:
    """调用 /x/web-interface/card 获取用户卡片信息（含昵称与头像）。"""
    url = 'https://api.bilibili.com/x/web-interface/card'
    params = {'mid': mid}
    try:
        resp = session.get(url, params=params, cookies=cookies, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if data.get('code') == 0 and data.get('data'):
            return data['data'].get('card')
        print(f"获取用户 {mid} 信息失败: {data.get('message', '未知错误')}")
    except requests.RequestException as e:
        print(f"获取用户 {mid} 信息异常: {e}")
    return None


def download_avatar(session: requests.Session, url: str, save_path: Path) -> bool:
    """下载头像到指定路径。"""
    try:
        # 有些头像URL可能缺少协议或是 http，统一转为 https
        if url.startswith('//'):
            url = 'https:' + url
        if url.startswith('http:'):
            url = url.replace('http:', 'https:')

        r = session.get(url, timeout=15)
        r.raise_for_status()
        save_path.parent.mkdir(parents=True, exist_ok=True)
        with open(save_path, 'wb') as f:
            f.write(r.content)
        return True
    except requests.RequestException as e:
        print(f'下载头像失败 {url}: {e}')
        return False


def fetch_follower_count(session: requests.Session, cookies: Dict[str, str], mid: str) -> Optional[int]:
    """调用 /x/relation/stat 获取粉丝数。"""
    url = 'https://api.bilibili.com/x/relation/stat'
    params = {'vmid': mid}
    try:
        resp = session.get(url, params=params, cookies=cookies, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if data.get('code') == 0 and data.get('data'):
            return int(data['data'].get('follower', 0))
        print(f"获取用户 {mid} 粉丝失败: {data.get('message', '未知错误')}")
    except requests.RequestException as e:
        print(f"获取用户 {mid} 粉丝异常: {e}")
    except (TypeError, ValueError):
        pass
    return None


def main():
    root = Path(__file__).parent
    txt_path = root / 'batch_ups.txt'
    output_json = root / 'batch_ups.json'
    avatar_dir = root / 'avatar_download'

    if not txt_path.exists():
        print(f'未找到 {txt_path}，请在脚本同目录放置 batch_ups.txt')
        sys.exit(1)

    cookies = get_cookies()
    session = build_session()

    mids: List[str] = []
    with open(txt_path, 'r', encoding='utf-8') as f:
        for line in f:
            url = line.strip()
            if not url:
                continue
            mid = extract_uid_from_url(url)
            if not mid:
                print(f'无法从该行提取UID，已跳过: {url}')
                continue
            if mid not in mids:
                mids.append(mid)

    print(f'共解析到 {len(mids)} 个UID')

    results: List[dict] = []
    for idx, mid in enumerate(mids, start=1):
        print(f'[{idx}/{len(mids)}] 获取 {mid} 信息...')
        card = fetch_user_card(session, cookies, mid)
        if not card:
            print(f'用户 {mid} 信息获取失败，跳过')
            continue

        name = card.get('name', '').strip()
        face_url = card.get('face', '').strip()
        if not name or not face_url:
            print(f'用户 {mid} 昵称或头像缺失，跳过')
            continue

        # 下载头像到本地 avatar_download/{mid}_avatar.jpg
        local_avatar_path = avatar_dir / f'{mid}_avatar.jpg'
        ok = download_avatar(session, face_url, local_avatar_path)
        if not ok:
            print(f'用户 {mid} 头像下载失败，跳过')
            continue

        # 获取粉丝数
        follower_count = fetch_follower_count(session, cookies, mid)
        follower_str = str(follower_count) if follower_count is not None else "0"

        # 生成 lastUpdate 时间
        last_update = datetime.now().strftime('%Y-%m-%d %H:%M')

        # 默认分类
        default_catagory = '长期观测'

        # 写入结果对象（avatar 字段固定为 /data/creators/{mid}_avatar.jpg）
        results.append({
            'mid': str(mid),
            'name': name,
            'avatar': f'/data/creators/{mid}_avatar.jpg',
            'followers': follower_str,
            'lastUpdate': last_update,
            'catagory': default_catagory
        })

        # 友好限速，避免过快
        time.sleep(0.2)

    # 输出 JSON
    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    # 额外输出一个批量UID的逗号分隔文件（单行）
    uids_txt = root / 'batch_up_uids.txt'
    with open(uids_txt, 'w', encoding='utf-8') as f:
        f.write(','.join(mids))

    print(f'完成：已写入 {output_json} 与 {uids_txt}，头像保存在 {avatar_dir}')


if __name__ == '__main__':
    main()


