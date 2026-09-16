import glob
import json
import os
import shutil
import sys
import tempfile
import traceback

try:
    import yt_dlp as youtube_dl
except ImportError:
    youtube_dl = None


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FFMPEG_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'ffmpeg', 'ffmpeg-build', 'bin'))
COOKIES_FILE = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'cookies.txt'))
COOKIE_TMP = None


def youtube_options():
    global COOKIE_TMP
    options = {'logger': Logger(), 'progress_hooks': [progress], 'quiet': True, 'no_warnings': False, 'noplaylist': True, 'retries': 10, 'fragment_retries': 10, 'merge_output_format': 'mp4'}
    # Usa o ffmpeg empacotado se existir; caso contrário, deixa o yt-dlp achar o ffmpeg do sistema no PATH.
    if os.path.isdir(FFMPEG_DIR):
        options['ffmpeg_location'] = FFMPEG_DIR
    # Habilita o Node como runtime JS do yt-dlp (EJS) quando disponível no PATH.
    node_path = shutil.which('node')
    if node_path:
        options['js_runtimes'] = {'node': {'path': node_path}}
    # Permite baixar o challenge solver EJS remoto (ejs:github) quando o YouTube exigir.
    options['remote_components'] = {'ejs:github'}
    # Usa uma CÓPIA temporária dos cookies: o yt-dlp reescreve o cookie jar ao final
    # e isso corrompia o cookies.txt original (perdia a sessão LOGIN_INFO).
    try:
        if os.path.exists(COOKIES_FILE) and os.path.getsize(COOKIES_FILE) > 256:
            COOKIE_TMP = os.path.join(tempfile.gettempdir(), f'savetube_cookies_{os.getpid()}.txt')
            shutil.copyfile(COOKIES_FILE, COOKIE_TMP)
            options['cookiefile'] = COOKIE_TMP
    except Exception:
        COOKIE_TMP = None
    return options


def cleanup_cookie_tmp():
    global COOKIE_TMP
    if COOKIE_TMP:
        try:
            if os.path.exists(COOKIE_TMP):
                os.remove(COOKIE_TMP)
        except Exception:
            pass
        COOKIE_TMP = None

def send(event):
    print(json.dumps(event, ensure_ascii=True), flush=True)


class Logger:
    def debug(self, message):
        if message and not message.startswith('[download]'):
            send({'type': 'log', 'message': message})
    def warning(self, message):
        send({'type': 'warning', 'message': message})
    def error(self, message):
        send({'type': 'error', 'message': message})


def progress(data):
    event = {'type': 'progress', 'status': data.get('status')}
    for source, target in [('downloaded_bytes', 'downloadedBytes'), ('total_bytes', 'totalBytes'), ('speed', 'speed'), ('eta', 'eta'), ('_percent_str', 'percent')]:
        if data.get(source) is not None:
            event[target] = data[source]
    send(event)


def public_info(info):
    formats = []
    for item in info.get('formats') or []:
        formats.append({'formatId': item.get('format_id'), 'ext': item.get('ext'), 'height': item.get('height'), 'width': item.get('width'), 'fps': item.get('fps'), 'filesize': item.get('filesize') or item.get('filesize_approx'), 'hasVideo': item.get('vcodec') not in (None, 'none'), 'hasAudio': item.get('acodec') not in (None, 'none')})
    is_live = bool(info.get('is_live')) or (info.get('live_status') in ('is_live', 'post_live', 'is_upcoming'))
    return {'id': info.get('id'), 'title': info.get('title'), 'duration': info.get('duration'), 'isLive': is_live, 'thumbnail': info.get('thumbnail'), 'uploader': info.get('uploader'), 'extractor': info.get('extractor_key') or info.get('extractor'), 'webpageUrl': info.get('webpage_url'), 'formats': formats}


def find_final_file(output_template):
    """Retorna o arquivo final gerado pelo yt-dlp (após merge/extração de áudio)."""
    try:
        directory = os.path.dirname(os.path.abspath(output_template))
        base = os.path.basename(output_template)
        prefix = base.split('-%(title)s')[0]
        candidates = []
        for path in glob.glob(os.path.join(directory, prefix + '*')):
            name = os.path.basename(path)
            if name.endswith(('.part', '.ytdl', '.temp', '.webm.tmp')):
                continue
            candidates.append(path)
        if not candidates:
            return None
        candidates.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        return candidates[0]
    except Exception:
        return None


def main():
    try:
        request = json.loads(sys.stdin.readline())
        if youtube_dl is None:
            send({'type': 'error', 'message': 'Dependência ausente: instale yt-dlp com "python -m pip install -r python/requirements.txt".'})
            return 1
        action = request.get('action')
        options = youtube_options()
        if action == 'inspect':
            with youtube_dl.YoutubeDL(options) as ydl:
                info = ydl.extract_info(request['url'], download=False)
            send({'type': 'metadata', 'data': public_info(ydl.sanitize_info(info))})
            send({'type': 'finished'})
            return 0
        options.update({'outtmpl': request['output'], 'format': request.get('format') or 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'})
        if request.get('audio'):
            options['format'] = 'bestaudio/best'
            options['postprocessors'] = [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192', 'nopostoverwrites': False}]
            options['postprocessor_args'] = {'extractaudio': ['-nostdin', '-y']}
        with youtube_dl.YoutubeDL(options) as ydl:
            info = ydl.extract_info(request['url'], download=True)
            filename = find_final_file(request['output']) or ydl.prepare_filename(info)
        send({'type': 'finished', 'file': filename})
        return 0
    finally:
        cleanup_cookie_tmp()


try:
    raise SystemExit(main())
except Exception as error:
    send({'type': 'error', 'message': str(error), 'detail': traceback.format_exc(limit=2)})
    raise SystemExit(1)
