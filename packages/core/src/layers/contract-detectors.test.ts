import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectContracts,
  detectSqlTables,
  detectTypeOrmEntities,
  detectSqlAlchemyModels,
  detectMongooseModels,
  detectSequelizeModels,
  detectEfCoreEntities,
} from "./contract-detectors.js";

test("detectSqlTables tags origin=sql", () => {
  const defs = detectSqlTables(`CREATE TABLE users (id INT PRIMARY KEY, email TEXT);`);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].name, "users");
  assert.equal(defs[0].origin, "sql");
  assert.equal(defs[0].source, "sql");
});

test("TypeORM @Entity with physical name + columns", () => {
  const src = `
    @Entity('user_accounts')
    export class UserAccount {
      @PrimaryGeneratedColumn() id: number;
      @Column() email: string;
      @Column({ nullable: true }) name: string;
    }
  `;
  const defs = detectTypeOrmEntities(src);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].name, "UserAccount");
  assert.equal(defs[0].physicalName, "user_accounts");
  assert.equal(defs[0].origin, "code");
  assert.deepEqual(defs[0].fields, ["id", "email", "name"]);
});

test("SQLAlchemy declarative model with __tablename__", () => {
  const src = [
    "class User(Base):",
    "    __tablename__ = 'users'",
    "    id = Column(Integer, primary_key=True)",
    "    email = Column(String)",
    "",
    "class Other:",
    "    pass",
  ].join("\n");
  const defs = detectSqlAlchemyModels(src);
  const user = defs.find((d) => d.name === "User");
  assert.ok(user, "User detected");
  assert.equal(user.physicalName, "users");
  assert.equal(user.source, "sqlalchemy");
  assert.deepEqual(user.fields, ["id", "email"]);
  assert.ok(!defs.find((d) => d.name === "Other"), "non-Base class ignored");
});

test("SQLAlchemy imperative Table()", () => {
  const defs = detectSqlAlchemyModels(`posts = Table("posts", metadata, Column("id", Integer))`);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].name, "posts");
  assert.equal(defs[0].physicalName, "posts");
});

test("Mongoose schema fields, name strips Schema suffix", () => {
  const src = `const UserSchema = new mongoose.Schema({ name: String, email: { type: String } });`;
  const defs = detectMongooseModels(src);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].name, "User");
  assert.equal(defs[0].source, "mongoose");
  assert.deepEqual(defs[0].fields, ["name", "email"]);
});

test("Sequelize define()", () => {
  const defs = detectSequelizeModels(`const User = sequelize.define('user', { name: DataTypes.STRING });`);
  const u = defs.find((d) => d.physicalName === "user");
  assert.ok(u);
  assert.deepEqual(u.fields, ["name"]);
});

test("EF Core DbSet<T> entities", () => {
  const src = `
    public class AppDbContext : DbContext {
      public DbSet<User> Users { get; set; }
      public DbSet<Order> Orders { get; set; }
    }
  `;
  const defs = detectEfCoreEntities(src);
  assert.deepEqual(defs.map((d) => d.name).sort(), ["Order", "User"]);
  assert.equal(defs[0].source, "efcore");
});

test("detectContracts dedupes a Sequelize class + init in one file", () => {
  const src = `
    class User extends Model {}
    User.init({ name: DataTypes.STRING }, { sequelize });
  `;
  const { definitions } = detectContracts("models/user.ts", src, null);
  const users = definitions.filter((d) => d.name === "User");
  assert.equal(users.length, 1, "one canonical User table, not two");
  assert.deepEqual(users[0].fields, ["name"]);
});
