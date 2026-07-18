import asyncio
import os
import shutil
import tempfile
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .converter import (
    MAX_FILE_BYTES,
    clamp_max_chars,
    is_supported_filename,
    markdown_filename,
    public_error_message,
)

NEWAPI_VALIDATION_URL = os.getenv('NEWAPI_VALIDATION_URL', 'https://api.jiucaihezi.studio').rstrip('/')
MARKITDOWN_TIMEOUT_SECONDS = 90

app = FastAPI(title='document-converter', version='0.1.0')


async def validate_api_key(authorization: str | None) -> None:
    if not authorization or not authorization.lower().startswith('bearer '):
        raise HTTPException(status_code=401, detail='需要有效的 API Key。')
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f'{NEWAPI_VALIDATION_URL}/v1/models',
                headers={'Authorization': authorization},
            )
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail='暂时无法校验 API Key。')
    if not response.is_success:
        raise HTTPException(status_code=401, detail='API Key 无效或已失效。')


async def save_upload(upload: UploadFile, directory: Path) -> tuple[Path, int]:
    source = directory / Path(upload.filename or 'document').name
    size = 0
    with source.open('wb') as target:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_FILE_BYTES:
                target.close()
                source.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail='文件超过 20 MB 上限。')
            target.write(chunk)
    return source, size


async def run_markitdown(source: Path, output: Path) -> str:
    process = await asyncio.create_subprocess_exec(
        'markitdown', str(source), '-o', str(output),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=MARKITDOWN_TIMEOUT_SECONDS)
    except TimeoutError:
        process.kill()
        await process.communicate()
        raise RuntimeError('转换超时，请缩小文件后重试。')
    if process.returncode != 0:
        raise RuntimeError(stderr.decode('utf-8', errors='replace').strip() or 'MarkItDown 未能读取该文档。')
    return output.read_text(encoding='utf-8', errors='replace').strip()


@app.get('/health')
async def health():
    return {'status': 'ok', 'service': 'document-converter'}


@app.post('/documents/markdown')
async def convert_document(
    file: UploadFile = File(...),
    max_chars: int | None = None,
    authorization: str | None = Header(default=None),
):
    await validate_api_key(authorization)
    filename = file.filename or 'document'
    if not is_supported_filename(filename):
        raise HTTPException(status_code=415, detail='仅支持 Word、PDF、Excel、PPT、OpenDocument 和 RTF 文档。')

    directory = Path(tempfile.mkdtemp(prefix='jc-document-'))
    try:
        source, _ = await save_upload(file, directory)
        output = directory / markdown_filename(filename)
        content = await run_markitdown(source, output)
        if not content:
            raise RuntimeError('没有提取到可读文字。')
        limit = clamp_max_chars(max_chars)
        truncated = len(content) > limit
        return {
            'status': 'success',
            'source': filename,
            'filename': markdown_filename(filename),
            'content': content[:limit],
            'engine': 'markitdown',
            'truncated': truncated,
            'message': '文档已转换为 Markdown。',
        }
    except HTTPException:
        raise
    except Exception as error:
        return JSONResponse(
            status_code=422,
            content={'status': 'error', 'message': public_error_message(str(error))},
        )
    finally:
        await file.close()
        shutil.rmtree(directory, ignore_errors=True)
