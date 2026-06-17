FROM node:20-slim

WORKDIR /app

# 只复制 package.json 和安装依赖
COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps

# 代码通过 volume 挂载，不复制进来

EXPOSE 5000

ENV NODE_ENV=development

CMD ["npm", "run", "dev:start"]
