import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectJavaFramework,
  findSpringAnnotatedFiles,
  findAndroidComponentFiles,
  getJavaConventionalExports,
} from '../../../../../src/analyzer/languages/java/javaFrameworkDetector';

describe('javaFrameworkDetector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'java-framework-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('detectJavaFramework', () => {
    it('should detect Spring Boot from pom.xml', () => {
      fs.writeFileSync(
        path.join(tempDir, 'pom.xml'),
        `<project>
          <parent>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-parent</artifactId>
          </parent>
          <dependencies>
            <dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter-web</artifactId>
            </dependency>
          </dependencies>
        </project>`
      );

      const result = detectJavaFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('spring');
    });

    it('should detect Spring Boot from build.gradle', () => {
      fs.writeFileSync(
        path.join(tempDir, 'build.gradle'),
        `plugins {
          id 'org.springframework.boot' version '3.2.0'
        }
        dependencies {
          implementation 'org.springframework.boot:spring-boot-starter-web'
        }`
      );

      const result = detectJavaFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('spring');
    });

    it('should detect Spring Boot from build.gradle.kts', () => {
      fs.writeFileSync(
        path.join(tempDir, 'build.gradle.kts'),
        `plugins {
          id("org.springframework.boot") version "3.2.0"
        }`
      );

      const result = detectJavaFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('spring');
    });

    it('should detect Android from build.gradle', () => {
      fs.writeFileSync(
        path.join(tempDir, 'build.gradle'),
        `apply plugin: 'com.android.application'
        android {
          compileSdkVersion 34
        }`
      );

      const result = detectJavaFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('android');
    });

    it('should detect Android from AndroidManifest.xml', () => {
      const manifestDir = path.join(tempDir, 'app', 'src', 'main');
      fs.mkdirSync(manifestDir, { recursive: true });
      fs.writeFileSync(
        path.join(manifestDir, 'AndroidManifest.xml'),
        '<manifest package="com.example.app" />'
      );

      const result = detectJavaFramework(tempDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('android');
    });

    it('should return null for plain Java project', () => {
      // Create a basic pom.xml without Spring Boot
      fs.writeFileSync(
        path.join(tempDir, 'pom.xml'),
        `<project>
          <dependencies>
            <dependency>
              <groupId>junit</groupId>
              <artifactId>junit</artifactId>
            </dependency>
          </dependencies>
        </project>`
      );

      const result = detectJavaFramework(tempDir);
      expect(result).toBeNull();
    });

    it('should return null when no build files exist', () => {
      const result = detectJavaFramework(tempDir);
      expect(result).toBeNull();
    });
  });

  describe('findSpringAnnotatedFiles', () => {
    it('should find files with @SpringBootApplication', () => {
      const srcDir = path.join(tempDir, 'src', 'main', 'java', 'com', 'example');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'Application.java'),
        `package com.example;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}`
      );

      const result = findSpringAnnotatedFiles(tempDir);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('Application.java');
    });

    it('should find files with @Controller annotation', () => {
      const srcDir = path.join(tempDir, 'src', 'main', 'java', 'com', 'example');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'UserController.java'),
        `package com.example;

@Controller
public class UserController {
    @GetMapping("/users")
    public String list() { return "users"; }
}`
      );

      const result = findSpringAnnotatedFiles(tempDir);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('UserController.java');
    });

    it('should find files with @Service annotation', () => {
      const srcDir = path.join(tempDir, 'src', 'main', 'java', 'com', 'example');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'UserService.java'),
        `package com.example;

@Service
public class UserService {
    public List<User> findAll() { return List.of(); }
}`
      );

      const result = findSpringAnnotatedFiles(tempDir);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('UserService.java');
    });

    it('should find files with @RestController annotation', () => {
      const srcDir = path.join(tempDir, 'src', 'main', 'java', 'com', 'example');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'ApiController.java'),
        `package com.example;

@RestController
@RequestMapping("/api")
public class ApiController {
}`
      );

      const result = findSpringAnnotatedFiles(tempDir);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('ApiController.java');
    });

    it('should find files with @Entity annotation', () => {
      const srcDir = path.join(tempDir, 'src', 'main', 'java', 'com', 'example');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'User.java'),
        `package com.example;

@Entity
public class User {
    @Id
    private Long id;
}`
      );

      const result = findSpringAnnotatedFiles(tempDir);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('User.java');
    });

    it('should not include plain Java files without annotations', () => {
      const srcDir = path.join(tempDir, 'src', 'main', 'java', 'com', 'example');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'Helper.java'),
        `package com.example;

public class Helper {
    public static String format(String s) { return s.trim(); }
}`
      );

      const result = findSpringAnnotatedFiles(tempDir);
      expect(result).toHaveLength(0);
    });
  });

  describe('findAndroidComponentFiles', () => {
    it('should find Activity classes', () => {
      const srcDir = path.join(tempDir, 'src', 'main', 'java', 'com', 'example');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'MainActivity.java'),
        `package com.example;

public class MainActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}`
      );

      const result = findAndroidComponentFiles(tempDir);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('MainActivity.java');
    });

    it('should find ViewModel classes', () => {
      const srcDir = path.join(tempDir, 'src', 'main', 'java', 'com', 'example');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'MainViewModel.java'),
        `package com.example;

public class MainViewModel extends ViewModel {
    private MutableLiveData<String> data;
}`
      );

      const result = findAndroidComponentFiles(tempDir);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('MainViewModel.java');
    });

    it('should find BroadcastReceiver classes', () => {
      const srcDir = path.join(tempDir, 'src', 'main', 'java', 'com', 'example');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'BootReceiver.java'),
        `package com.example;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {}
}`
      );

      const result = findAndroidComponentFiles(tempDir);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('BootReceiver.java');
    });

    it('should not include plain Java files', () => {
      const srcDir = path.join(tempDir, 'src', 'main', 'java', 'com', 'example');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'Util.java'),
        `package com.example;

public class Util {
    public static void doSomething() {}
}`
      );

      const result = findAndroidComponentFiles(tempDir);
      expect(result).toHaveLength(0);
    });
  });

  describe('getJavaConventionalExports', () => {
    it('should return Spring conventional exports', () => {
      fs.writeFileSync(
        path.join(tempDir, 'pom.xml'),
        `<project>
          <dependencies>
            <dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter-web</artifactId>
            </dependency>
          </dependencies>
        </project>`
      );

      const exports = getJavaConventionalExports(tempDir);
      expect(exports).toContain('findById');
      expect(exports).toContain('findAll');
      expect(exports).toContain('configure');
      expect(exports).toContain('doFilter');
    });

    it('should return Android conventional exports', () => {
      const manifestDir = path.join(tempDir, 'app', 'src', 'main');
      fs.mkdirSync(manifestDir, { recursive: true });
      fs.writeFileSync(
        path.join(manifestDir, 'AndroidManifest.xml'),
        '<manifest package="com.example.app" />'
      );

      const exports = getJavaConventionalExports(tempDir);
      expect(exports).toContain('onCreate');
      expect(exports).toContain('onResume');
      expect(exports).toContain('onReceive');
      expect(exports).toContain('onCleared');
    });

    it('should return empty array for plain Java project', () => {
      const exports = getJavaConventionalExports(tempDir);
      expect(exports).toEqual([]);
    });
  });
});
