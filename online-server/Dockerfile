FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
COPY src ./src
RUN mvn -q -Dmaven.test.skip=true package

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN groupadd --system linkshot && useradd --system --gid linkshot linkshot
COPY --from=build /build/target/linkshot-online-0.1.0.jar /app/app.jar
USER linkshot
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
