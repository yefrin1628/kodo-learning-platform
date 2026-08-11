import { Module } from '@nestjs/common';
import { LearningController } from './learning.controller';
import { LearningService } from './learning.service';
import { AnswerValidatorService } from './answer-validator.service';

@Module({
  controllers: [LearningController],
  providers: [LearningService, AnswerValidatorService],
})
export class LearningModule {}
