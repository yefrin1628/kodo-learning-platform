import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class MatchPairDto {
  @IsString()
  left!: string;

  @IsString()
  right!: string;
}

export class SubmitAnswerDto {
  // choice / tf / fill / bug / listen / predict / convo — index of the
  // ExerciseOption the student picked.
  @IsOptional()
  @IsInt()
  @Min(0)
  selectedIndex?: number;

  // type_answer / translate / order — the assembled/typed text.
  @IsOptional()
  @IsString()
  text?: string;

  // run — the student's JavaScript.
  @IsOptional()
  @IsString()
  code?: string;

  // match — the pairs the student connected.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatchPairDto)
  pairs?: MatchPairDto[];

  @IsOptional()
  @IsIn(['lesson', 'practice'])
  mode?: 'lesson' | 'practice';
}
