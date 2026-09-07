import { Module } from '@nestjs/common';
import { SshModule } from '../ssh/ssh.module';
import { AiChatService } from './ai-chat.service';
import { AiChatController } from './ai-chat.controller';

@Module({
  imports: [SshModule],
  providers: [AiChatService],
  controllers: [AiChatController],
})
export class AiChatModule {}
