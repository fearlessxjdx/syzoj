import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj, ErrorMessage: any;

import User from "./user";
import Problem from "./problem";
import Contest from "./contest";

const Judger = syzoj.lib('judger');

@TypeORM.Entity()
@TypeORM.Index(['id', 'is_public', 'type_info', 'type'])
export default class JudgeState extends Model {
  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  // The data zip's md5 if it's a submit-answer problem
  @TypeORM.Column({ nullable: true, type: "mediumtext" })
  code: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 20 })
  language: string;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "varchar", length: 50 })
  status: string;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "varchar", length: 50 })
  task_id: string;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  score: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  total_time: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  code_length: number;

  @TypeORM.Column({ nullable: true, type: "boolean" })
  pending: boolean;

  @TypeORM.Column({ nullable: true, type: "integer" })
  max_memory: number;

  @TypeORM.Column({ nullable: true, type: "json" })
  compilation: any;

  @TypeORM.Column({ nullable: true, type: "json" })
  result: any;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  user_id: number;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  problem_id: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  submit_time: number;

  /*
   * "type" indicate it's contest's submission(type = 1) or normal submission(type = 0)
   * if it's contest's submission (type = 1), the type_info is contest_id
   * use this way represent because it's easy to expand // Menci：这锅我不背，是 Chenyao 留下来的坑。
   */
  @TypeORM.Column({ nullable: true, type: "integer" })
  type: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  type_info: number;
  
  @TypeORM.Column({ nullable: true, type: "boolean" })
  is_public: boolean;

  user?: User;
  problem?: Problem;

  async loadRelationships() {
    if (!this.user) {
      this.user = await User.findById(this.user_id);
    }
    if (!this.problem) {
      if (this.problem_id) this.problem = await Problem.findById(this.problem_id);
    }
  }

  async isAllowedVisitBy(user) {
    await this.loadRelationships();

    if (user && user.id === this.problem.user_id) return true;
    else if (this.type === 0) return this.problem.is_public || (user && (await user.hasPrivilege('manage_problem')));
    else if (this.type === 1) {
      let contest = await Contest.findById(this.type_info);
      if (contest.isRunning()) {
        return user && await contest.isSupervisior(user);
      } else {
        return true;
      }
    }
  }

  async updateRelatedInfo(newSubmission) {
    if (this.type === 0) {
      await this.loadRelationships();

      // No need to await them.
      this.user.refreshSubmitInfo();
      this.problem.resetSubmissionCount();
    } else if (this.type === 1) {
      let contest = await Contest.findById(this.type_info);
      await contest.newSubmission(this);
    }
  }

  async rejudge() {
    await syzoj.utils.lock(['JudgeState::rejudge', this.id], async () => {
      await this.loadRelationships();

      let oldStatus = this.status;

      this.status = 'Unknown';
      this.pending = false;
      this.score = null;
      if (this.language) {
        // language is empty if it's a submit-answer problem
        this.total_time = null;
        this.max_memory = null;
      }
      this.result = {};
      this.task_id = require('randomstring').generate(10);
      await this.save();

      await this.problem.resetSubmissionCount();
      if (oldStatus === 'Accepted') {
        await this.user.refreshSubmitInfo();
        await this.user.save();
      }

      if (this.type === 1) {
        let contest = await Contest.findById(this.type_info);
        await contest.newSubmission(this);
      }

      try {
        await Judger.judge(this, this.problem, 1);
        this.pending = true;
        this.status = 'Waiting';
        await this.save();
      } catch (err) {
        console.log("Error while connecting to judge frontend: " + err.toString());
        throw new ErrorMessage("无法开始评测。");
      }
    });
  }

  async getProblemType() {
    await this.loadRelationships();
    return this.problem.type;
  }
}
