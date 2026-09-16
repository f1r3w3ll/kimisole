import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
COOKIES_PATH = os.path.join(ROOT, 'cookies.txt')


def log(message: str):
    print(message, flush=True)


def save_cookies(cookies: list):
    lines = ['# Netscape HTTP Cookie File', '# https://curl.se/docs/http-cookies.html', '']
    for cookie in cookies:
        domain = cookie.get('domain', '')
        flag = 'TRUE' if domain.startswith('.') else 'FALSE'
        path = cookie.get('path', '/')
        secure = 'TRUE' if cookie.get('secure') else 'FALSE'
        expiry = str(cookie.get('expires', '0'))
        if expiry in ('', 'None'):
            expiry = '0'
        name = cookie.get('name', '')
        value = cookie.get('value', '')
        lines.append('\t'.join([domain, flag, path, secure, expiry, name, value]))
    with open(COOKIES_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    log(f'Cookies salvos em {COOKIES_PATH}')


def main():
    email = os.environ.get('YOUTUBE_EMAIL')
    password = os.environ.get('YOUTUBE_PASSWORD')
    if not email or not password:
        log('YOUTUBE_EMAIL e YOUTUBE_PASSWORD devem estar configurados no .env')
        return 1

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        log('Abrindo YouTube...')
        page.goto('https://www.youtube.com', wait_until='domcontentloaded', timeout=60000)
        time.sleep(2)

        log('Navegando para login...')
        page.goto('https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26hl%3Dpt%26next%3Dhttps%253A%252F%252Fwww.youtube.com%252F', timeout=60000)
        time.sleep(2)

        log('Preenchendo e-mail...')
        page.fill('input[type="email"]', email)
        page.click('#identifierNext')
        time.sleep(3)

        log('Preenchendo senha...')
        page.fill('input[type="password"]', password)
        page.click('#passwordNext')
        time.sleep(5)

        if 'myaccount.google.com' in page.url or 'youtube.com' in page.url:
            log('Login aparentemente bem-sucedido. Coletando cookies...')
            cookies = context.cookies()
            save_cookies(cookies)
            browser.close()
            return 0

        if 'signin/rejected' in page.url or 'challenge' in page.url:
            log('Google exigiu verificação adicional (2FA/captcha). Não é possível automatizar.')
            browser.close()
            return 1

        log(f'URL inesperada após login: {page.url}')
        browser.close()
        return 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as e:
        log(f'Erro: {e}')
        raise SystemExit(1)
