FROM node:22
# Create app directory
WORKDIR /usr/src/app

# Install app dependencies (production only)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY . .

ENV PORT=3000
EXPOSE 3000
CMD [ "node", "server.js" ]
