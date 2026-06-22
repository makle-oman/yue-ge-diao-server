import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type { RawData, WebSocket } from 'ws';
import { Public } from '../../common/decorators/public.decorator';
import { MessagesService, type MessageItem } from './messages.service';
import type { SendMessageDto } from './dto/messages.dto';

interface AccessTokenPayload {
  sub: string;
  typ: 'access' | 'refresh';
}

interface SocketEnvelope<T = unknown> {
  event?: string;
  data?: T;
}

@Public()
@WebSocketGateway({ path: '/ws/messages' })
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly clients = new Map<string, Set<WebSocket>>();
  private readonly clientUsers = new WeakMap<WebSocket, string>();

  constructor(
    private readonly jwt: JwtService,
    private readonly messagesService: MessagesService,
  ) {}

  async handleConnection(client: WebSocket, request: IncomingMessage) {
    const userId = await this.resolveUserId(request.url ?? '');
    if (!userId) {
      client.close(1008, 'Unauthorized');
      return;
    }

    this.clientUsers.set(client, userId);
    const sockets = this.clients.get(userId) ?? new Set<WebSocket>();
    sockets.add(client);
    this.clients.set(userId, sockets);

    client.on('message', (raw) => {
      void this.handleMessage(userId, client, raw);
    });
  }

  handleDisconnect(client: WebSocket) {
    const userId = this.clientUsers.get(client);
    if (!userId) return;

    const sockets = this.clients.get(userId);
    if (!sockets) return;
    sockets.delete(client);
    if (!sockets.size) this.clients.delete(userId);
  }

  private async resolveUserId(url: string): Promise<string | null> {
    const token = new URL(url, 'http://localhost').searchParams.get('token');
    if (!token) return null;

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      return payload.typ === 'access' && payload.sub ? payload.sub : null;
    } catch {
      return null;
    }
  }

  private async handleMessage(userId: string, client: WebSocket, raw: RawData) {
    const message = this.parseMessage(raw);
    if (message.event !== 'message:send') return;

    try {
      const sent = await this.messagesService.send(BigInt(userId), message.data as SendMessageDto);
      this.emitTo(sent.fromId, 'message:new', sent);
      this.emitTo(sent.toId, 'message:new', sent);
    } catch (e) {
      this.send(client, 'message:error', {
        msg: e instanceof Error ? e.message : 'send failed',
      });
    }
  }

  private parseMessage(raw: RawData): SocketEnvelope {
    try {
      const text = Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : raw.toString();
      const parsed = JSON.parse(text) as SocketEnvelope;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private emitTo(userId: string, event: string, data: MessageItem) {
    const sockets = this.clients.get(userId);
    if (!sockets) return;
    sockets.forEach((client) => this.send(client, event, data));
  }

  private send(client: WebSocket, event: string, data: unknown) {
    if (client.readyState !== client.OPEN) return;
    client.send(JSON.stringify({ event, data }));
  }
}
