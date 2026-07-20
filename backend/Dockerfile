# ---------- Stelladream 后端 Dockerfile ----------
FROM python:3.11-slim

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. 最重最稳：Torch（500MB+，几乎不改，放最上面充分利用缓存）
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# 2. 常改的：业务依赖（改了只重跑这一层，不牵连 torch）
COPY requirements.txt ./requirements.txt
RUN grep -v torch requirements.txt > requirements-no-torch.txt && \
    pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements-no-torch.txt

# 3. 最频繁改的：代码
COPY ./ ./

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
