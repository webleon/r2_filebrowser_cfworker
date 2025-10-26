// =================================================================
// 配置常量
// =================================================================
const BUCKET_BINDING_NAME = "FILES";          // 对应 wrangler.toml 中的 [[r2_buckets]] binding
const KV_BINDING_NAME = "RATE_LIMITER";       // 对应 wrangler.toml 中的 [[kv_namespaces]] binding (可选，用于频率限制)
const LIMIT_COUNT = 30;                        // 速率限制：时间窗口内允许的请求次数
const TIME_WINDOW_SECONDS = 60;               // 速率限制：时间窗口（秒）
const PAGE_SIZE = 10;                          // 客户端分页：每页显示的条目数

// =================================================================
// 辅助函数：速率限制检查 (必须先定义)
// =================================================================
async function checkRateLimit(ip, namespace) {
    const key = ip; 
    const currentCount = await namespace.get(key);
    
    if (currentCount) {
        const count = parseInt(currentCount);
        if (count >= LIMIT_COUNT) {
            // 超过限制
            return { limited: true, remaining: 0 };
        }
        // 增加计数并设置过期时间
        await namespace.put(key, String(count + 1), { expirationTtl: TIME_WINDOW_SECONDS });
        return { limited: false, remaining: LIMIT_COUNT - count - 1 };
    } else {
        // 首次请求：设置计数为 1，并设置过期时间
        await namespace.put(key, "1", { expirationTtl: TIME_WINDOW_SECONDS });
        return { limited: false, remaining: LIMIT_COUNT - 1 };
    }
}

// =================================================================
// 辅助函数：文件服务 (已修复)
// =================================================================
async function serveFile(bucket, key) {
    const object = await bucket.get(key);

    if (object === null) {
        return new Response("文件未找到 (File not found)", { status: 404 });
    }

    // 核心修复：添加 Content-Disposition 头部，强制浏览器使用 key 作为下载文件名
    const contentDisposition = `attachment; filename="${key}"`;
    
    // 核心：设置 Cache-Control 头部，实现浏览器缓存，减少重复请求
    const cacheControl = "public, max-age=3600"; // 缓存 1 小时

    return new Response(object.body, {
        headers: {
            "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
            "Cache-Control": cacheControl,
            "Content-Length": object.size,
            "Content-Disposition": contentDisposition, // <-- 修复点
        },
    });
}

// =================================================================
// 辅助函数：格式化文件大小
// =================================================================
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// =================================================================
// 辅助函数：生成 HTML 列表和客户端分页 JS
// =================================================================
function createHtmlListPage(listObjects, currentPage, totalPages) {
    // listObjects 应包含 { key: string, size: number }
    
    // 1. 生成文件列表的 HTML 行
    const listItems = listObjects.map(obj => {
        const formattedSize = formatBytes(obj.size);
        return `
            <li class="file-item">
                <a href="?file=${encodeURIComponent(obj.key)}" target="_blank" download class="file-link">
                    ${obj.key}
                </a>
                <span class="file-size">${formattedSize}</span>
            </li>
        `;
    }).join('');

    // 2. 生成分页导航 HTML (初始状态) - 使用图标符号
    const paginationHtml = `
        <div class="pagination">
            <a href="?page=1" title="首页">«</a>
            <a href="?page=${currentPage > 1 ? currentPage - 1 : 1}" title="上一页">‹</a>
            <span><span id="current-page-display">${currentPage}</span> / ${totalPages || 1}</span>
            <a href="?page=${currentPage < (totalPages || 1) ? currentPage + 1 : (totalPages || 1)}" title="下一页">›</a>
            <a href="?page=${totalPages || 1}" title="尾页">»</a>
        </div>
    `;

    // 3. 构造完整的 HTML 页面，包含客户端分页的 JavaScript
    const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>R2 文件浏览器</title>
    <style>
        /* 现代/响应式设计 */
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
            line-height: 1.4; 
            margin: 0; 
            padding: 0; 
            background-color: #e9ecef; /* 浅灰色背景 */
        }
        .container { 
            max-width: 900px; 
            margin: 20px auto; /* 手机端保留边距 */
            background: white; 
            padding: 20px; 
            border-radius: 10px; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.1); 
        }
        h1 { color: #343a40; margin-bottom: 40px; padding-bottom: 0; }
        ul { 
            list-style: none; 
            padding: 0; 
            border-top: 1px solid #dee2e6; /* 列表整体顶部边框 */
        }
        .file-item { 
            display: flex; 
            font-size: 1.1em;
            justify-content: space-between; /* 文件名靠左，大小靠右 */
            align-items: center;
            border-bottom: 1px solid #dee2e6; /* 每行底部边框，实现上下分割线效果 */
            padding: 12px 5px; 
            transition: background-color 0.2s;
        }
        .file-item:hover {
            background-color: #f8f9fa;
        }
        .file-link { 
            color: #007bff; 
            flex-grow: 1; /* 链接占据大部分空间 */
            word-break: break-all; /* 防止超长文件名溢出 */
        }
        .file-link:hover { text-decoration: underline; }
        .file-size { 
            color: #ABB0B4; 
            font-size: 0.8em; 
            margin-left: 15px; 
            flex-shrink: 0; /* 大小固定，不被压缩 */
            text-align: right;
            min-width: 70px; /* 确保大小有足够空间 */
        }
        .pagination { 
            margin-top: 40px; 
            text-align: center; 
            padding: 5px 10px; 
            display: flex;
            justify-content: center;
            flex-wrap: wrap; /* 响应式支持 */
        }
        .pagination a { 
            margin: 0px 10px; /* 调整边距 */
            padding: 0px 15px;
            border: 1px solid #ccc;
            border-radius: 6px;
            text-decoration: none;
            color: #007bff; 
            font-size: 1.5em; /* 符号适当放大 */
        }
        .pagination a:hover {
            background-color: #e9ecef;
        }
        .pagination span { 
            margin: 5px 5px; 
            color: #495057;
            padding: 5px 0;
        }

    </style>
</head>
<body>
    <div class="container">
        <h1>文件列表</h1>
        <ul id="file-list">
            <!-- 文件列表将由 JS 动态插入 -->
        </ul>
        ${paginationHtml}
    </div>

    <script>
        // 从 Worker 接收到的所有文件数据 (已排序，包含 size)
        const ALL_FILES = ${JSON.stringify(listObjects)};
        const TOTAL_PAGES = ${totalPages || 1};
        const PAGE_SIZE = ${PAGE_SIZE};
        
        // -------------------------------------------------
        // 客户端分页逻辑
        // -------------------------------------------------
        function renderPage(page) {
            const listElement = document.getElementById('file-list');
            const currentPageDisplay = document.getElementById('current-page-display');
            const paginationDiv = document.querySelector('.pagination');
            
            listElement.innerHTML = ''; // 清空当前列表

            if (ALL_FILES.length === 0) {
                listElement.innerHTML = '<li>目录为空 (Directory is empty).</li>';
                currentPageDisplay.textContent = '1';
                // 列表为空时，分页只显示当前页 1/1
                paginationDiv.innerHTML = '<span><span id="current-page-display">1</span> / 1</span>';
                return;
            }

            if (page < 1) page = 1;
            if (page > TOTAL_PAGES) page = TOTAL_PAGES;
            
            const start = (page - 1) * PAGE_SIZE;
            const end = start + PAGE_SIZE;
            const filesToShow = ALL_FILES.slice(start, end);

            // 重新生成列表项
            const listItemsHtml = filesToShow.map(obj => \`
                <li class="file-item">
                    <a href="?file=\${encodeURIComponent(obj.key)}" target="_blank" download class="file-link">
                        \${obj.key}
                    </a>
                    <span class="file-size">\${formatBytes(obj.size)}</span>
                </li>
            \`).join('');

            listElement.innerHTML = listItemsHtml;
            
            // 更新分页状态
            currentPageDisplay.textContent = page;
            
            // 重新生成分页链接 (确保链接指向正确的页码)
            const prevPage = page > 1 ? page - 1 : 1;
            const nextPage = page < TOTAL_PAGES ? page + 1 : TOTAL_PAGES;
            paginationDiv.innerHTML = \`
                <a href="?page=1" title="首页">«</a>
                <a href="?page=\${prevPage}" title="上一页">‹</a>
                <span><span id="current-page-display">\${page}</span> / \${TOTAL_PAGES}</span>
                <a href="?page=\${nextPage}" title="下一页">›</a>
                <a href="?page=\${TOTAL_PAGES}" title="尾页">»</a>
            \`;
        }

        // 格式化字节的函数，必须在 JS 作用域内可用
        function formatBytes(bytes, decimals = 2) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        }

        // 解析 URL 中的 page 参数
        const urlParams = new URLSearchParams(window.location.search);
        let initialPage = parseInt(urlParams.get('page')) || 1;
        
        // 确保初始页码有效
        if (ALL_FILES.length === 0) {
            initialPage = 1;
        } else if (initialPage < 1) {
            initialPage = 1;
        } else if (initialPage > TOTAL_PAGES) {
            initialPage = TOTAL_PAGES;
        }

        // 首次渲染
        renderPage(initialPage);

        // 监听分页链接的点击事件，实现单页应用效果
        document.addEventListener('click', function(e) {
            if (e.target.tagName === 'A' && e.target.closest('.pagination')) {
                e.preventDefault();
                const pageParam = e.target.search.split('=')[1];
                let targetPage = 1;
                
                if (pageParam) {
                    targetPage = parseInt(pageParam) || 1;
                }
                
                if (ALL_FILES.length === 0) {
                    targetPage = 1;
                } else if (targetPage < 1) {
                    targetPage = 1;
                } else if (targetPage > TOTAL_PAGES) {
                    targetPage = TOTAL_PAGES;
                }
                
                renderPage(targetPage);
                // 更新地址栏而不刷新页面
                history.pushState(null, '', \`?page=\${targetPage}\`);
            }
        });
    </script>
</body>
</html>
    `;
    
    // 列表页使用 HTML 响应，不缓存
    return new Response(htmlContent, {
        headers: { 
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate" 
        }
    });
}

// =================================================================
// 主处理函数
// =================================================================
export default {
    async fetch(request, env, ctx) {
        if (!env[BUCKET_BINDING_NAME]) {
            return new Response(`R2 绑定 '${BUCKET_BINDING_NAME}' 未配置`, { status: 500 });
        }
        
        const url = new URL(request.url);
        const bucket = env[BUCKET_BINDING_NAME]; 
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown'; 
        const responseHeaders = new Headers();

        // 1. 检查 HTTP 方法
        if (request.method !== 'GET') {
            return new Response("不支持的请求方法 (Method Not Allowed)", { status: 405 });
        }

        // 2. 速率限制检查（如果 KV 绑定存在）
        if (env[KV_BINDING_NAME]) { 
            const namespace = env[KV_BINDING_NAME];
            const limitResult = await checkRateLimit(ip, namespace);
            
            if (limitResult.limited) {
                // 速率限制响应
                return new Response(`请求过于频繁，请在 ${TIME_WINDOW_SECONDS} 秒后重试。`, { 
                    status: 429, 
                    headers: {
                        'Retry-After': String(TIME_WINDOW_SECONDS),
                        'X-RateLimit-Limit': String(LIMIT_COUNT),
                        'X-RateLimit-Remaining': '0',
                    }
                });
            }
            // 将剩余次数添加到响应头 (可选)
            responseHeaders.set('X-RateLimit-Remaining', String(limitResult.remaining));
        }

        // 3. 处理文件请求 (?file=...)
        const requestedFileKey = url.searchParams.get('file');

        if (requestedFileKey) {
            // 路径遍历防护
            if (requestedFileKey.includes('..') || requestedFileKey.startsWith('/')) {
                 return new Response("无效的文件名 (Invalid file key)", { status: 400 });
            }
            return serveFile(bucket, requestedFileKey);
        } 
        
        // 4. 默认处理：列表页 (返回 HTML)
        const list = await bucket.list();
        
        // 排序：按文件名升序排列，并获取 size 信息
        const allObjects = list.objects 
            ? list.objects.map(obj => ({ key: obj.key, size: obj.size })).sort((a, b) => a.key.localeCompare(b.key)) 
            : [];
        
        const totalItems = allObjects.length;
        const totalPages = Math.ceil(totalItems / PAGE_SIZE);
        
        // 获取当前页码（从 URL 获取）
        let currentPage = 1;
        if (url.searchParams.has('page')) {
            currentPage = parseInt(url.searchParams.get('page')) || 1;
        }
        // 修正当前页码
        if (totalPages === 0) {
            currentPage = 1;
        } else if (currentPage < 1) {
            currentPage = 1;
        } else if (currentPage > totalPages) {
            currentPage = totalPages;
        }

        // 提取当前页所需的文件对象（包含 key 和 size）
        const start = (currentPage - 1) * PAGE_SIZE;
        const end = start + PAGE_SIZE;
        const filesForCurrentPageObjects = allObjects.slice(start, end);

        // 生成 HTML 页面
        return createHtmlListPage(filesForCurrentPageObjects, currentPage, totalPages);
    },
};
