/*
 * joi-messages-query — FDA-safe Messages database reader
 *
 * This binary directly opens chat.db using the sqlite3 C API.
 * macOS TCC (Full Disk Access) checks the process that calls open(),
 * so granting FDA to THIS binary is sufficient — no need to grant
 * FDA to node, sqlite3, or the entire terminal.
 *
 * Drop-in replacement for `sqlite3 -readonly [-json] <db> <sql>`.
 *
 * Compile: cc -O2 -o joi-messages-query joi-messages-query.c -lsqlite3
 * Grant FDA: System Settings > Privacy & Security > Full Disk Access > + > select this binary
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sqlite3.h>

static void print_json_string(const char *s) {
    putchar('"');
    if (s) {
        for (; *s; s++) {
            switch (*s) {
                case '"':  fputs("\\\"", stdout); break;
                case '\\': fputs("\\\\", stdout); break;
                case '\n': fputs("\\n", stdout);  break;
                case '\r': fputs("\\r", stdout);  break;
                case '\t': fputs("\\t", stdout);  break;
                default:
                    if ((unsigned char)*s < 0x20) {
                        fprintf(stdout, "\\u%04x", (unsigned char)*s);
                    } else {
                        putchar(*s);
                    }
            }
        }
    }
    putchar('"');
}

int main(int argc, char *argv[]) {
    int json_mode = 0;
    const char *db_path = NULL;
    const char *sql = NULL;

    /* Parse args: [-readonly] [-json] <db_path> <sql> */
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-readonly") == 0) continue;
        if (strcmp(argv[i], "-json") == 0) { json_mode = 1; continue; }
        if (!db_path) { db_path = argv[i]; continue; }
        if (!sql)     { sql = argv[i]; continue; }
    }

    if (!db_path || !sql) {
        fprintf(stderr, "Usage: %s [-readonly] [-json] <db_path> <sql>\n", argv[0]);
        return 1;
    }

    sqlite3 *db;
    int rc = sqlite3_open_v2(db_path, &db, SQLITE_OPEN_READONLY, NULL);
    if (rc != SQLITE_OK) {
        fprintf(stderr, "Error: unable to open database \"%s\": %s\n",
                db_path, sqlite3_errmsg(db));
        sqlite3_close(db);
        return 1;
    }

    sqlite3_stmt *stmt;
    rc = sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        fprintf(stderr, "Error: %s\n", sqlite3_errmsg(db));
        sqlite3_close(db);
        return 1;
    }

    int ncols = sqlite3_column_count(stmt);

    if (json_mode) {
        printf("[");
        int first_row = 1;
        while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
            if (!first_row) printf(",");
            printf("{");
            for (int i = 0; i < ncols; i++) {
                if (i > 0) printf(",");
                print_json_string(sqlite3_column_name(stmt, i));
                printf(":");
                int type = sqlite3_column_type(stmt, i);
                if (type == SQLITE_NULL) {
                    printf("null");
                } else if (type == SQLITE_INTEGER) {
                    printf("%lld", sqlite3_column_int64(stmt, i));
                } else if (type == SQLITE_FLOAT) {
                    printf("%g", sqlite3_column_double(stmt, i));
                } else {
                    print_json_string((const char *)sqlite3_column_text(stmt, i));
                }
            }
            printf("}");
            first_row = 0;
        }
        printf("]\n");
    } else {
        while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
            for (int i = 0; i < ncols; i++) {
                if (i > 0) printf("|");
                const char *val = (const char *)sqlite3_column_text(stmt, i);
                printf("%s", val ? val : "");
            }
            printf("\n");
        }
    }

    if (rc != SQLITE_DONE) {
        fprintf(stderr, "Error: %s\n", sqlite3_errmsg(db));
    }

    sqlite3_finalize(stmt);
    sqlite3_close(db);
    return (rc == SQLITE_DONE) ? 0 : 1;
}
