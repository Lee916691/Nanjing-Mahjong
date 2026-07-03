import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
const port = Number(process.env.PORT ?? 3000);

const app = express();

app.use(
  cors({
    origin: clientOrigin,
  }),
);

app.get('/health', (_request: Request, response: Response) => {
  response.json({ status: 'ok' });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: clientOrigin,
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  socket.emit('server:hello', { message: 'connected' });
});

httpServer.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
