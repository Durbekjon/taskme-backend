import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

export interface NotificationPayload {
  id?: string;
  type: string;
  title: string;
  message: string;
  referenceId?: string | null;
  createdAt?: string;
}

/**
 * WebSocket gateway that pushes real-time events to authenticated users.
 *
 * Auth: clients connect with `{ auth: { token: '<jwt>' } }` in the Socket.io
 * handshake. Connections that fail JWT verification are immediately dropped.
 *
 * Usage in services: inject NotificationsGateway and call emitToUser().
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: false },
  namespace: '/',
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  /** userId → set of active socket IDs (one user can have multiple tabs/devices). */
  private readonly userSockets = new Map<string, Set<string>>();

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth as { token?: string })?.token ??
      (client.handshake.headers.authorization ?? '').replace('Bearer ', '');

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify<{ sub: string }>(token);
      client.data.userId = payload.sub;

      const sockets = this.userSockets.get(payload.sub) ?? new Set<string>();
      sockets.add(client.id);
      this.userSockets.set(payload.sub, sockets);

      this.logger.debug(`Connected: user=${payload.sub} socket=${client.id}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId as string | undefined;
    if (!userId) return;

    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(client.id);
      if (sockets.size === 0) this.userSockets.delete(userId);
    }
    this.logger.debug(`Disconnected: user=${userId} socket=${client.id}`);
  }

  /** Emit an event to every socket belonging to a specific user. */
  emitToUser(userId: string, event: string, data: unknown): void {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    for (const socketId of sockets) {
      this.server.to(socketId).emit(event, data);
    }
  }

  /** How many live sockets a user has (useful for deciding whether to also push). */
  isOnline(userId: string): boolean {
    return (this.userSockets.get(userId)?.size ?? 0) > 0;
  }
}
