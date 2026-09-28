// 可選整合測試：需 librime 開發頭文件及函式庫；只使用傳入的隔離測試目錄。
#include <rime_api.h>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

void require(bool ok, const std::string& message) {
  if (!ok) throw std::runtime_error(message);
}

int main(int argc, char** argv) {
  if (argc != 3) {
    std::cerr << "usage: test_rime_engine ISOLATED_USER_DIR SHARED_DATA_DIR\n";
    return 2;
  }
  RimeApi* api = rime_get_api();
  RIME_STRUCT(RimeTraits, traits);
  traits.user_data_dir = argv[1];
  traits.shared_data_dir = argv[2];
  traits.app_name = "rime.preng-test";
  traits.min_log_level = 2;
  api->setup(&traits);
  api->initialize(&traits);
  api->deployer_initialize(&traits);
  try {
    std::map<std::string, std::string> codes;
    std::ifstream table(std::string(argv[1]) + "/codes.tsv");
    std::string line;
    std::getline(table, line);
    while (std::getline(table, line)) {
      std::istringstream input(line);
      std::vector<std::string> fields;
      std::string field;
      while (std::getline(input, field, '\t')) fields.push_back(field);
      require(fields.size() == 6, "invalid codes.tsv");
      codes[fields[1]] = fields[5];
    }
    require(codes.size() == 3809, "missing codes.tsv");
    for (const auto& schema : {"preng", "preng_sp"}) {
      auto file = std::string(argv[1]) + "/" + schema + ".schema.yaml";
      require(api->deploy_schema(file.c_str()), "deploy failed: " + file);
    }
    auto session = api->create_session();
    require(session != 0, "create_session failed");
    const std::vector<std::pair<std::string, std::string>> fixtures = {
      {"東", "twung"}, {"冬", "towng"}, {"豪", "ghoaw"}, {"生", "sriaeng"},
      {"打", "taengq"}, {"冷", "laengq"}, {"地", "dih"}, {"爹", "tiae"},
      {"𩦠", "biangq"}, {"怎", "tsvmq"}, {"書", "hjo"}, {"脂", "tji"},
      {"中古", "trung koq"}, {"中古漢語", "trung koq hanh ngvoq"},
    };
    int checked = 0;
    for (const auto& schema : {"preng", "preng_sp"}) {
      require(api->select_schema(session, schema), "cannot select schema");
      for (const auto& fixture : fixtures) {
        for (const auto& separator : {"", "'"}) {
          std::istringstream words(fixture.second);
          std::string word, keys;
          while (words >> word) {
            if (!keys.empty()) keys += separator;
            keys += std::string(schema) == "preng" ? word : codes.at(word);
          }
          api->clear_composition(session);
          for (char key : keys) require(api->process_key(session, key, 0), "unhandled key: " + keys);
          RimeCandidateListIterator iter = {};
          require(api->candidate_list_begin(session, &iter), "no candidates: " + keys);
          bool found = false;
          while (api->candidate_list_next(&iter)) {
            if (fixture.first == iter.candidate.text) {
              require(iter.candidate.comment && std::string(iter.candidate.comment).find(fixture.second) != std::string::npos,
                      "missing full spelling: " + keys);
              found = true;
              break;
            }
            if (iter.index > 1000) break;
          }
          auto index = iter.index;
          api->candidate_list_end(&iter);
          require(found, "missing candidate " + fixture.first + ": " + keys);
          require(api->select_candidate(session, index), "candidate selection failed");
          RIME_STRUCT(RimeCommit, commit);
          if (!api->get_commit(session, &commit)) {
            api->commit_composition(session);
            require(api->get_commit(session, &commit), "commit failed");
          }
          require(fixture.first == commit.text, "wrong committed text");
          api->free_commit(&commit);
          checked++;
        }
      }
      // 未輸滿音節時應仍有補全候選。
      const auto prefix = std::string(schema) == "preng" ? "tw" : codes.at("twung").substr(0, 2);
      api->clear_composition(session);
      for (char key : prefix) api->process_key(session, key, 0);
      RIME_STRUCT(RimeContext, context);
      require(api->get_context(session, &context), "no prefix context");
      require(context.menu.num_candidates > 0, "no partial input candidates");
      api->free_context(&context);
    }
    api->destroy_session(session);
    std::cout << "librime " << api->get_version() << ": " << checked
              << " candidate/comment/commit checks passed, plus prefix completion.\n";
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    api->finalize();
    return 1;
  }
  api->finalize();
}
