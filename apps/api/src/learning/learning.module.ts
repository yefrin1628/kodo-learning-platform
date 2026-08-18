import { Module } from '@nestjs/common';
import { LearningController } from './learning.controller';
import { LearningService } from './learning.service';
import { AnswerValidatorService } from './answer-validator.service';
import { AchievementsService } from './achievements.service';
import { ChallengesService } from './challenges.service';
import { VocabularyModule } from '../vocabulary/vocabulary.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ExecutionModule } from '../execution/execution.module';

@Module({
  imports: [VocabularyModule, SubscriptionsModule, ExecutionModule],
  controllers: [LearningController],
  providers: [LearningService, AnswerValidatorService, AchievementsService, ChallengesService],
})
export class LearningModule {}
