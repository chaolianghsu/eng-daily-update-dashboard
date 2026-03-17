// src/google.script.d.ts
declare namespace google {
  namespace script {
    interface Runner {
      withSuccessHandler(handler: (result: any) => void): Runner;
      withFailureHandler(handler: (error: any) => void): Runner;
      [functionName: string]: (...args: any[]) => void;
    }
    const run: Runner;
  }
}
