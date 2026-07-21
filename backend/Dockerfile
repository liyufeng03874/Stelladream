# ---------- Stelladream 后端 Dockerfile ----------
FROM python:3.11-slim

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. 业务依赖（走阿里云源）
# 注：已移除 torch/sentence-transformers 依赖，改为调 other-world HTTP API
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt

# 2. 最频繁改的：代码
COPY ./ ./

EXPOSE 8002

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8002"]
