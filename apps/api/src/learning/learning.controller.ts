import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LearningService } from './learning.service';
import { SubmitAnswerDto } from './dto/submit-answer.dto';

@UseGuards(JwtAuthGuard)
@Controller('learning')
export class LearningController {
  constructor(private readonly learningService: LearningService) {}

  @Post('exercises/:exerciseId/answer')
  answer(
    @CurrentUser() user: { userId: string },
    @Param('exerciseId') exerciseId: string,
    @Body() dto: SubmitAnswerDto,
  ) {
    return this.learningService.answerExercise(user.userId, exerciseId, dto);
  }

  @Post('lessons/:key/complete')
  complete(@CurrentUser() user: { userId: string }, @Param('key') key: string) {
    return this.learningService.completeLesson(user.userId, key);
  }

  // No @Body() on purpose: cost/target hearts are fixed server-side
  // constants, never read from the client.
  @Post('hearts/refill')
  refillHearts(@CurrentUser() user: { userId: string }) {
    return this.learningService.refillHearts(user.userId);
  }
}
