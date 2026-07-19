# ---------- Stelladream 后端 Dockerfile ----------
FROM python:3.11-slim

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先拷依赖，利用缓存（加阿里云 pip 镜像，排除 torch）
COPY requirements.txt ./requirements.txt
RUN grep -v torch requirements.txt > requirements-no-torch.txt && \
    pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements-no-torch.txt && \
    pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# 再拷代码
COPY ./ ./

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
