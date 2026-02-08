package com.example;

public class UnusedService {
    public void doSomething() {
        System.out.println("Nobody imports this class");
    }

    public String getName() {
        return "UnusedService";
    }
}
