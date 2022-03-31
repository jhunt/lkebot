FROM node
COPY package.json .
RUN npm install

COPY . .
CMD ["/bin/sh", "-c", "node index.js"]
